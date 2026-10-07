// On-chain actions on Robinhood Chain, signed with the bot wallet. Each flow is a line-by-line
// port of the game's own client (assets/buy-*.js, LoadFailed-*.js, PawsEarned-*.js):
//   buy     = Universal Router V4 swap USDG->PAWS (or ETH->USDG->PAWS), then vault deposit
//   deposit = PAWS.approve(vault) + vault.deposit(amount) + POST /cat/deposit-confirm {txHash}
//   collect = claim(ticket) on the reward contract + POST /rewards/claims/:id/collected
//   member  = USDG.transfer(receiver, amountUnits) + POST /membership/confirm {txHash}
import {
  createPublicClient, createWalletClient, defineChain, http, fallback, getAddress, formatUnits, parseUnits,
  parseAbi, parseAbiParameters, encodeAbiParameters, encodePacked, encodeFunctionData, decodeEventLog,
} from 'viem';
import { ApiError } from './api.js';

const ERC20 = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const PERMIT2 = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);
const ROUTER = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const V4_QUOTER = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);
const V3_QUOTER = parseAbi([
  'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const STATE_VIEW = parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)']);
const HOOK = parseAbi(['function buyFeeBps() view returns (uint16)']);
const VAULT = parseAbi(['function deposit(uint256 amount)', 'function paused() view returns (bool)']);
const CLAIM = [{ type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{ name: 'claimId', type: 'bytes32' }, { name: 'token', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'signature', type: 'bytes' }], outputs: [] }];

const SWAP_PARAMS = parseAbiParameters('((address, address, uint24, int24, address), bool, uint128, uint128, uint256, bytes)');
const ADDR_AMT = parseAbiParameters('address, uint256');
const ACTIONS = parseAbiParameters('bytes, bytes[]');
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';
const CONTRACT_BALANCE = 1n << 255n;
const Q192 = 1n << 192n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Chain {
  constructor(client, game) {
    this.c = client;
    this.g = game;
    this.account = client.account;
  }

  async init() {
    if (this.setup) return;
    const buy = await this.c.get('/buy');
    const s = buy.setup;
    this.buyVisible = buy.visible;
    this.setup = s;
    this.chain = defineChain({ id: s.chain.id, name: s.chain.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [s.chain.rpcUrl] } } });
    // Official RPC first; some networks (e.g. ISP/office "internet sehat" filters) block it,
    // so fall back to dRPC's public Robinhood Chain endpoint (verified chainId 4663).
    const urls = [...new Set([process.env.RPC_URL, s.chain.rpcUrl, 'https://robinhood.drpc.org'].filter(Boolean))];
    const transport = fallback(urls.map((u) => http(u, { retryCount: 1, timeout: 20000 })));
    this.pub = createPublicClient({ chain: this.chain, transport });
    this.wal = createWalletClient({ account: this.account, chain: this.chain, transport });
    this.key = { currency0: getAddress(s.pool.currency0), currency1: getAddress(s.pool.currency1), fee: s.pool.fee, tickSpacing: s.pool.tickSpacing, hooks: getAddress(s.pool.hooks) };
    this.usdg = getAddress(s.usdg.address);
    this.zeroForOne = this.key.currency0.toLowerCase() === this.usdg.toLowerCase();
    this.paws = this.zeroForOne ? this.key.currency1 : this.key.currency0;
    this.vault = getAddress(s.contracts.vault);
    this.router = getAddress(s.contracts.universalRouter);
    this.permit2 = getAddress(s.contracts.permit2);
  }

  explorerTx(hash) { return `${this.setup.chain.explorerUrl}/tx/${hash}`; }

  // Simulate first so a call that would revert costs nothing.
  async sendCall({ to, data, value = 0n }, dryRun = false) {
    await this.pub.call({ account: this.account, to, data, value });
    if (dryRun) return { dryRun: true, logs: [], transactionHash: null };
    const hash = await this.wal.sendTransaction({ account: this.account, chain: this.chain, to, data, value });
    const rc = await this.pub.waitForTransactionReceipt({ hash, timeout: 600000 });
    if (rc.status !== 'success') throw new Error(`Transaksi ditolak on-chain: ${hash}`);
    return rc;
  }

  write(address, abi, functionName, args, value) {
    return this.sendCall({ to: address, data: encodeFunctionData({ abi, functionName, args }), value });
  }

  async balances() {
    await this.init();
    const a = this.account.address;
    const [eth, paws, usdg] = await Promise.all([
      this.pub.getBalance({ address: a }),
      this.pub.readContract({ address: this.paws, abi: ERC20, functionName: 'balanceOf', args: [a] }),
      this.pub.readContract({ address: this.usdg, abi: ERC20, functionName: 'balanceOf', args: [a] }),
    ]);
    return { eth: formatUnits(eth, 18), paws: formatUnits(paws, 18), usdg: formatUnits(usdg, this.setup.usdg.decimals), raw: { eth, paws, usdg } };
  }

  // ---------- price / quote (port of X() and Ne())
  async quoteUsdg(amountIn, slippageBps = this.setup.limits.defaultSlippageBps) {
    await this.init();
    const s = this.setup;
    const [q, slot0, feeBps] = await Promise.all([
      this.pub.simulateContract({ address: getAddress(s.contracts.v4Quoter), abi: V4_QUOTER, functionName: 'quoteExactInputSingle', args: [{ poolKey: this.key, zeroForOne: this.zeroForOne, exactAmount: amountIn, hookData: '0x' }] }).then((r) => r.result[0]).catch(() => null),
      this.pub.readContract({ address: getAddress(s.contracts.stateView), abi: STATE_VIEW, functionName: 'getSlot0', args: [s.pool.id] }).catch(() => null),
      this.pub.readContract({ address: getAddress(s.contracts.hook), abi: HOOK, functionName: 'buyFeeBps' }).then(Number).catch(() => 300),
    ]);
    const fee = (amountIn * BigInt(feeBps)) / (10000n + BigInt(feeBps));
    let impactBps = 10000;
    if (q !== null && slot0) {
      const sq = slot0[0] * slot0[0];
      const n = amountIn - fee;
      const spot = this.zeroForOne ? (n * sq) / Q192 : (n * Q192) / sq;
      impactBps = spot <= 0n ? 10000 : q >= spot ? 0 : Number(((spot - q) * 10000n) / spot);
    }
    const out = q;
    const minOut = out === null ? 0n : (out * BigInt(10000 - slippageBps)) / 10000n;
    return { amountIn, out, minOut, fee, feeBps, impactBps };
  }

  async quoteEth(ethIn, slippageBps) {
    await this.init();
    const r = this.setup.ethRoute;
    let usdgOut = 0n;
    try {
      const { result } = await this.pub.simulateContract({ address: getAddress(r.v3Quoter), abi: V3_QUOTER, functionName: 'quoteExactInputSingle', args: [{ tokenIn: getAddress(r.weth), tokenOut: this.usdg, amountIn: ethIn, fee: r.fee, sqrtPriceLimitX96: 0n }] });
      usdgOut = result[0];
    } catch {}
    return { ...(await this.quoteUsdg(usdgOut, slippageBps)), ethIn, usdgOut };
  }

  // Human-readable price of 1 PAWS in USDG (from a 1 USDG quote).
  async pawsPrice() {
    await this.init();
    const one = parseUnits('1', this.setup.usdg.decimals);
    const q = await this.quoteUsdg(one);
    if (!q.out) return null;
    return 1 / Number(formatUnits(q.out, 18));
  }

  checkLimits(q, payEth) {
    const s = this.setup;
    const dec = s.usdg.decimals;
    const usdgIn = payEth ? q.usdgOut : q.amountIn;
    if (usdgIn < parseUnits(s.limits.minUsdg, dec)) throw new Error(`Minimal beli ${s.limits.minUsdg} USDG`);
    if (usdgIn > parseUnits(s.limits.maxUsdg, dec)) throw new Error(`Maksimal beli ${s.limits.maxUsdg} USDG per transaksi`);
    if (!q.out) throw new Error('Pool tidak bisa mengisi jumlah itu sekarang, coba lebih kecil');
    if (q.impactBps >= s.limits.blockImpactBps) throw new Error(`Price impact ${(q.impactBps / 100).toFixed(1)}% terlalu besar, kecilkan jumlah`);
  }

  // ---------- buy (port of qe() non-batch path + Ge())
  async buyWithUsdg(usdgAmount, { slippageBps = this.setup?.limits?.defaultSlippageBps ?? 100, log = () => {} } = {}) {
    await this.init();
    if (!this.buyVisible) throw new Error('Beli $PAWS sedang dimatikan oleh game');
    const s = this.setup;
    const amountIn = parseUnits(String(usdgAmount), s.usdg.decimals);
    const q = await this.quoteUsdg(amountIn, slippageBps);
    this.checkLimits(q, false);
    const now = Math.floor(Date.now() / 1000);
    const deadline = BigInt(now + s.limits.deadlineSeconds);
    const permitExpiration = now + 1800;
    const me = this.account.address;
    const [toPermit2, p2] = await Promise.all([
      this.pub.readContract({ address: this.usdg, abi: ERC20, functionName: 'allowance', args: [me, this.permit2] }),
      this.pub.readContract({ address: this.permit2, abi: PERMIT2, functionName: 'allowance', args: [me, this.usdg, this.router] }),
    ]);
    if (toPermit2 < amountIn) { log('Approve USDG ke Permit2...'); await this.write(this.usdg, ERC20, 'approve', [this.permit2, amountIn]); }
    if (p2[0] < amountIn || BigInt(p2[1]) <= deadline) { log('Izinkan router (Permit2)...'); await this.write(this.permit2, PERMIT2, 'approve', [this.usdg, this.router, amountIn, permitExpiration]); }
    const actions = encodePacked(['uint8', 'uint8', 'uint8'], [6, 12, 15]);
    const params = [
      encodeAbiParameters(SWAP_PARAMS, [[[this.key.currency0, this.key.currency1, this.key.fee, this.key.tickSpacing, this.key.hooks], this.zeroForOne, amountIn, q.minOut, 0n, '0x']]),
      encodeAbiParameters(ADDR_AMT, [this.usdg, amountIn]),
      encodeAbiParameters(ADDR_AMT, [this.paws, q.minOut]),
    ];
    const data = encodeFunctionData({ abi: ROUTER, functionName: 'execute', args: [encodePacked(['uint8'], [16]), [encodeAbiParameters(ACTIONS, [actions, params])], deadline] });
    log('Swap USDG → PAWS...');
    const rc = await this.sendCall({ to: this.router, data });
    const received = this.receivedPaws(rc.logs);
    return { swapHash: rc.transactionHash, received: formatUnits(received, 18), receivedRaw: received };
  }

  async buyWithEth(ethAmount, { slippageBps = this.setup?.limits?.defaultSlippageBps ?? 100, log = () => {}, dryRun = false } = {}) {
    await this.init();
    if (!this.buyVisible) throw new Error('Beli $PAWS sedang dimatikan oleh game');
    const s = this.setup;
    const ethIn = parseUnits(String(ethAmount), 18);
    const q = await this.quoteEth(ethIn, slippageBps);
    this.checkLimits(q, true);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + s.limits.deadlineSeconds);
    const r = s.ethRoute;
    const wrap = encodeAbiParameters(ADDR_AMT, [ADDRESS_THIS, ethIn]);
    const path = encodePacked(['address', 'uint24', 'address'], [getAddress(r.weth), r.fee, this.usdg]);
    const v3 = encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [ADDRESS_THIS, CONTRACT_BALANCE, 0n, path, false]);
    const settle = encodeAbiParameters(parseAbiParameters('address, uint256, bool'), [this.usdg, CONTRACT_BALANCE, false]);
    const swap = encodeAbiParameters(SWAP_PARAMS, [[[this.key.currency0, this.key.currency1, this.key.fee, this.key.tickSpacing, this.key.hooks], this.zeroForOne, 0n, q.minOut, 0n, '0x']]);
    const take = encodeAbiParameters(ADDR_AMT, [this.paws, q.minOut]);
    const v4 = encodeAbiParameters(ACTIONS, [encodePacked(['uint8', 'uint8', 'uint8'], [11, 6, 15]), [settle, swap, take]]);
    const data = encodeFunctionData({ abi: ROUTER, functionName: 'execute', args: [encodePacked(['uint8', 'uint8', 'uint8'], [11, 0, 16]), [wrap, v3, v4], deadline] });
    log('Swap ETH → USDG → PAWS...');
    const rc = await this.sendCall({ to: this.router, data, value: ethIn }, dryRun);
    if (dryRun) return { dryRun: true, expected: formatUnits(q.out, 18), minOut: formatUnits(q.minOut, 18), usdg: formatUnits(q.usdgOut, this.setup.usdg.decimals) };
    const received = this.receivedPaws(rc.logs);
    return { swapHash: rc.transactionHash, received: formatUnits(received, 18), receivedRaw: received };
  }

  receivedPaws(logs) {
    let total = 0n;
    for (const l of logs) {
      if (l.address.toLowerCase() !== this.paws.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: ERC20, data: l.data, topics: l.topics });
        if (ev.eventName === 'Transfer' && ev.args.to.toLowerCase() === this.account.address.toLowerCase()) total += ev.args.value;
      } catch {}
    }
    return total;
  }

  // ---------- deposit (port of Ge() + Ue())
  async deposit(amount, log = () => {}) {
    await this.init();
    const units = typeof amount === 'bigint' ? amount : parseUnits(String(amount), 18);
    if (units <= 0n) throw new Error('Jumlah deposit harus > 0');
    const allowance = await this.pub.readContract({ address: this.paws, abi: ERC20, functionName: 'allowance', args: [this.account.address, this.vault] });
    if (allowance < units) { log('Approve PAWS ke vault...'); await this.write(this.paws, ERC20, 'approve', [this.vault, units]); }
    log('Deposit PAWS ke game...');
    const rc = await this.write(this.vault, VAULT, 'deposit', [units]);
    const txHash = rc.transactionHash;
    const waits = [2000, 4000, 8000, 15000, 30000];
    let note = null;
    for (let i = 0; ; i++) {
      try {
        const credited = await this.c.post('/cat/deposit-confirm', { txHash });
        return { txHash, credited };
      } catch (e) {
        if (e.code === 'DEPOSIT_UNCONFIRMED') { note = e.message; if (e.details?.awaitingSafe) break; } else if (e.code !== 'NOT_FOUND') throw e;
        if (waits[i] === undefined) break;
        await sleep(waits[i]);
      }
    }
    return { txHash, credited: null, pendingNote: note ?? 'Deposit masih menunggu konfirmasi chain; server akan mengkreditkan otomatis.' };
  }

  async buyAndDeposit(pay, amount, log) {
    const r = pay === 'eth' ? await this.buyWithEth(amount, { log }) : await this.buyWithUsdg(amount, { log });
    if (r.receivedRaw <= 0n) return r;
    const d = await this.deposit(r.receivedRaw, log);
    return { ...r, ...d };
  }

  // ---------- withdraw (server pays gas)
  withdraw(amount) {
    return this.c.post('/cat/withdraw', { amount: String(amount) }, { idempotent: true });
  }

  // ---------- reward collect (port of et() + w() + ct())
  async collectReward(alloc, log = () => {}) {
    await this.init();
    let claimId = alloc.claimId;
    if (alloc.status === 'ALLOCATED' && alloc.claimable) {
      const r = await this.g.claimReward(alloc.id);
      if (r.status === 'HELD') return { held: true };
      claimId = r.claimId ?? claimId;
      if (!r.collect) return { credited: true, credit: r.credit ?? null };
    }
    if (!claimId) return { state: 'NO_CLAIM' };
    let col = await this.c.get(`/rewards/claims/${claimId}/collect`);
    for (let i = 0; i < 10 && col.state === 'PREPARING'; i++) { await sleep(3000); col = await this.c.get(`/rewards/claims/${claimId}/collect`); }
    if (col.state === 'COLLECTED') return { collected: true, txHash: col.txHash, amount: col.amount, symbol: col.symbol };
    if (col.state !== 'READY' || !col.ticket) return { state: col.state };
    const t = col.ticket;
    log(`Collect ${col.amount} ${col.symbol} on-chain...`);
    const rc = await this.write(getAddress(t.contract), CLAIM, 'claim', [t.claimId, getAddress(t.token), getAddress(t.recipient), BigInt(t.amountUnits), BigInt(t.deadline), t.signature]);
    const end = Date.now() + 180000;
    for (;;) {
      try { await this.c.post(`/rewards/claims/${claimId}/collected`, { txHash: rc.transactionHash }); break; } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'TX_PENDING' || Date.now() > end) throw e;
        await sleep(1500);
      }
    }
    return { collected: true, txHash: rc.transactionHash, amount: col.amount, symbol: col.symbol };
  }

  // ---------- membership (port of oe() + Te())
  async buyMembership() {
    await this.init();
    const m = await this.g.membership();
    if (!m.available || !m.payment) throw new Error(`Membership tidak tersedia (${m.unavailableReason ?? 'tidak ada payment'})`);
    const token = getAddress(m.payment.tokenAddress);
    const units = BigInt(m.payment.amountUnits);
    const bal = await this.pub.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [this.account.address] });
    if (bal < units) throw new Error(`Saldo ${m.quoteAsset} kurang: punya ${formatUnits(bal, m.payment.decimals)}, butuh ${m.price}`);
    const rc = await this.write(token, ERC20, 'transfer', [getAddress(m.payment.receiver), units]);
    const end = Date.now() + 180000;
    for (;;) {
      try { return { txHash: rc.transactionHash, ...(await this.c.post('/membership/confirm', { txHash: rc.transactionHash })) }; } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'TX_PENDING' || Date.now() > end) throw e;
        await sleep(2000);
      }
    }
  }
}
