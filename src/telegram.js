// Telegram control panel: one dashboard message that is edited in place as you tap buttons.
// Only the chat in TELEGRAM_CHAT_ID can use it.
import { n, esc, num, dur, until, ago, bar, RES_ICON, ACT_ICON, RARITY_ICON } from './format.js';
import { parseUnits, formatUnits } from 'viem';
import { ApiError } from './api.js';

// Server eligibility reason codes (GET /rewards -> eligibility.reasons) in plain words.
const ELIG_TEXT = {
  ACCOUNT_TOO_NEW: (r) => `akun terlalu baru (minimal ${r.minAccountAgeHours} jam)`,
  TUTORIAL_INCOMPLETE: () => 'tutorial belum selesai (bot otomatis)',
  CAT_LEVEL_TOO_LOW: (r) => `belum ada kucing level ${r.minCatLevel}+ (bot otomatis level up)`,
  NOT_ENOUGH_ACTIVITY: (r) => `kurang dari ${r.minClaimedJobs} shift penghasil poin yang diklaim (bot pakai shift 10 menit dulu)`,
  NO_SPEND_OR_STAKE: (r) => `PAWS yang dibelanjakan di game/di-stake < ${num(r.minSpendOrDeposit)} (deposit & beli di Market tidak dihitung; level up, upgrade, rekrut, permit, repair, nap, fast track dihitung)`,
  RISK_SCORE: () => 'akun sedang direview',
  ACCOUNT_FROZEN: () => 'akun dibekukan',
  REWARDS_HOLD: () => 'reward ditahan',
  SECURITY_HOLD: () => 'security hold',
};
// Blocker codes returned by the server (quotes, permits, recruitment), worded from the game's own map.
const BLOCK_TEXT = {
  INSUFFICIENT_CAT: 'PAWS kurang', INSUFFICIENT_RESOURCES: 'resource kurang (kerjakan stasiun penghasilnya)',
  NOT_ENOUGH_FRAGMENTS: 'fragment belum cukup', CAT_BUSY: 'kucing sedang kerja', WORKING: 'kucing masih ada shift/harvest',
  UPGRADING: 'kucing sedang persiapan upgrade', UPGRADE_IN_PROGRESS: 'upgrade sedang berjalan', CAT_LISTED: 'kucing sedang dijual',
  LISTED: 'kucing sedang dijual', IN_TRADE: 'kucing ada di trade', ACCLIMATING: 'kucing masih aklimasi', NAPPING: 'kucing sedang tidur',
  XP_NOT_MET: 'XP belum cukup (kerja shift dulu)', LEVEL_CAP: 'sudah level maksimal', STARTER_LEVEL: 'naikkan level starter cat dulu',
  TUTORIAL_INCOMPLETE: 'tutorial belum sampai Tavern', PERMIT_LIMIT: 'kantor permit penuh', STATION_SLOTS_FULL: 'slot stasiun penuh (simpan stasiun / perluas lahan)',
  CAT_CAPACITY_FULL: 'roster penuh', RECRUITMENT_IN_PROGRESS: 'rekrut sedang berjalan', CRAFT_IN_PROGRESS: 'craft sedang berjalan',
  ACTIVE_CATS_LIMIT: 'batas kucing aktif tier ini', PLOT_TOO_SMALL: 'lahan terlalu kecil', STARTER_CAT: 'starter cat terikat akun',
  PROTECTED: 'lepas protect dulu', RELEASE_COOLDOWN: 'kucing baru datang', ALREADY_RELEASED: 'sudah di-release', TARGET_DISABLED: 'target tidak tersedia',
};
const blockers = (list) => (list ?? []).map((b) => BLOCK_TEXT[b] ?? b).join(', ');
const SHIFT_MODES =['auto', '10', '30', '60', '120', '240', '480'];
const NOTIFY_MODES = ['important', 'all', 'off'];

export class TelegramUI {
  constructor({ token, chatId, engine, settings }) {
    this.api = `https://api.telegram.org/bot${token}`;
    this.chatId = chatId ? String(chatId) : null;
    this.e = engine;
    this.g = engine.g;
    this.s = settings;
    this.actions = new Map();   // callback id -> closure
    this.seq = 0;
    this.awaiting = null;       // pending text input
    this.offset = 0;
    this.panel = null;          // message id of the dashboard
  }

  // ---------- Telegram plumbing
  async call(method, body) {
    const r = await fetch(`${this.api}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok && !/message is not modified/.test(j.description ?? '')) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
    return j.result;
  }

  send(text, kb) {
    if (!this.chatId) return null;
    return this.call('sendMessage', { chat_id: this.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: kb ? { inline_keyboard: kb } : undefined });
  }

  notify(text) { this.send(esc(text)).catch(() => {}); }

  btn(text, fn) {
    const id = (++this.seq).toString(36);
    this.actions.set(id, fn);
    if (this.actions.size > 3000) this.actions.delete(this.actions.keys().next().value);
    return { text, callback_data: `a:${id}` };
  }

  async show(screen, msgId = this.panel) {
    const { text, kb } = await screen.call(this);
    const markup = { inline_keyboard: kb ?? [] };
    if (msgId) {
      try {
        await this.call('editMessageText', { chat_id: this.chatId, message_id: msgId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
        this.panel = msgId;
        return;
      } catch {}
    }
    const m = await this.call('sendMessage', { chat_id: this.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
    this.panel = m.message_id;
  }

  start() {
    this.call('setMyCommands', { commands: [
      { command: 'menu', description: 'Dashboard' },
      { command: 'cats', description: 'Kucing' },
      { command: 'market', description: 'Marketplace' },
      { command: 'wallet', description: 'Wallet, beli & deposit PAWS' },
      { command: 'rewards', description: 'Reward & eligibility' },
      { command: 'referral', description: 'Referral' },
      { command: 'log', description: 'Log aktivitas' },
      { command: 'pause', description: 'Matikan otomatis' },
      { command: 'resume', description: 'Nyalakan otomatis' },
      { command: 'help', description: 'Panduan tombol' },
    ] }).catch(() => {});
    const poll = async () => {
      try {
        const ups = await this.call('getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
        for (const u of ups ?? []) {
          this.offset = u.update_id + 1;
          await this.handle(u).catch((e) => console.error('TG handler:', e.message));
        }
      } catch (e) {
        console.error(e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
      setImmediate(poll);
    };
    poll();
  }

  async handle(u) {
    const from = String(u.message?.chat.id ?? u.callback_query?.message?.chat.id ?? '');
    if (!this.chatId) {
      console.log(`Pesan Telegram dari chat id ${from}. Isi TELEGRAM_CHAT_ID=${from} di .env lalu restart.`);
      if (u.message) await this.call('sendMessage', { chat_id: from, text: `Chat id kamu: ${from}\nIsi TELEGRAM_CHAT_ID=${from} di .env lalu restart bot.` });
      return;
    }
    if (from !== this.chatId) return;

    if (u.callback_query) {
      const q = u.callback_query;
      const fn = this.actions.get((q.data ?? '').slice(2));
      this.call('answerCallbackQuery', { callback_query_id: q.id, text: fn ? undefined : 'Menu kadaluarsa, buka /menu' }).catch(() => {});
      if (!fn) return;
      this.panel = q.message.message_id;
      const next = await this.guard(fn);
      if (typeof next === 'function') await this.show(next);
      return;
    }

    const text = (u.message?.text ?? '').trim();
    if (this.awaiting && !text.startsWith('/')) {
      const a = this.awaiting;
      this.awaiting = null;
      const next = await this.guard(() => a.handler(text));
      this.panel = null;
      await this.show(typeof next === 'function' ? next : this.home);
      return;
    }
    this.awaiting = null;
    const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*/, '');
    this.panel = null;
    if (cmd === '/pause') { this.s.set('running', false); return this.show(this.home); }
    if (cmd === '/resume') { this.s.set('running', true); return this.show(this.home); }
    if (cmd === '/log') return this.show(this.logScreen);
    if (cmd === '/cats') return this.show(this.catsScreen);
    if (cmd === '/market') return this.show(this.marketScreen);
    if (cmd === '/wallet') return this.show(this.walletScreen);
    if (cmd === '/reward' || cmd === '/rewards') return this.show(this.rewardsScreen);
    if (cmd === '/referral') return this.show(this.referralScreen);
    if (cmd === '/help') return this.show(this.helpScreen);
    await this.show(this.home);
  }

  // Runs a button action; API errors become a toast-style message instead of crashing.
  async guard(fn) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : e.message;
      await this.send(`⚠️ <b>Gagal</b>\n${esc(msg)}`).catch(() => {});
      return null;
    }
  }

  // Do something, report it, then go back to `back`.
  doThen(label, fn, back) {
    return async () => {
      await fn();
      await this.e.refresh().catch(() => {});
      this.flash = `✅ ${label}`;
      return back ?? this.home;
    };
  }

  confirm(question, label, fn, back) {
    return () => async function confirmScreen() {
      return {
        text: `❓ <b>Konfirmasi</b>\n\n${question}`,
        kb: [[this.btn('✅ Ya, lanjut', this.doThen(label, fn, back)), this.btn('✖️ Batal', () => back ?? this.home)]],
      };
    };
  }

  ask(prompt, handler) {
    return async () => {
      this.awaiting = { handler };
      await this.send(`✏️ ${prompt}\n<i>(kirim balasan sebagai pesan biasa, /menu untuk batal)</i>`);
      return null;
    };
  }

  // Reward eligibility as a checklist with real progress (GET /rewards + /jobs?status=CLAIMED).
  async eligibilityChecklist(rw) {
    const el = rw.eligibility;
    const ru = el.rules;
    const has = (r) => el.reasons.includes(r);
    const me = this.state().me;
    const maxLvl = Math.max(0, ...(this.state().cats ?? []).map((c) => c.level));
    const claimed = await this.g.jobs('CLAIMED').then((r) => r.jobs.filter((j) => j.snapshot?.rewardEligible && n(j.result?.gamePoints) > 0).length).catch(() => null);
    const line = (ok, text) => `${ok ? '✅' : '❌'} ${text}`;
    const rows = [
      line(!has('TUTORIAL_INCOMPLETE') && me?.user?.tutorialCompleted !== false, 'Tutorial selesai'),
      line(!has('CAT_LEVEL_TOO_LOW'), `Kucing level ${ru.minCatLevel}+ (tertinggi L${maxLvl})`),
      line(!has('NOT_ENOUGH_ACTIVITY'), `${ru.minClaimedJobs} shift penghasil poin diklaim${claimed !== null ? ` (${Math.min(claimed, ru.minClaimedJobs)}/${ru.minClaimedJobs})` : ''} — shift ≥10 menit di stasiun 🎁; shift 3 menit tutorial tidak dihitung`),
      line(!has('NO_SPEND_OR_STAKE'), `Belanja ${num(ru.minSpendOrDeposit)} $PAWS di dalam game (level up, upgrade, rekrut, permit, repair, nap, fast track) atau stake — deposit &amp; beli di Market tidak dihitung`),
    ];
    if (ru.minAccountAgeHours) rows.push(line(!has('ACCOUNT_TOO_NEW'), `Akun minimal ${ru.minAccountAgeHours} jam`));
    for (const r of el.reasons.filter((x) => !['TUTORIAL_INCOMPLETE', 'CAT_LEVEL_TOO_LOW', 'NOT_ENOUGH_ACTIVITY', 'NO_SPEND_OR_STAKE', 'ACCOUNT_TOO_NEW'].includes(x))) rows.push(line(false, esc(ELIG_TEXT[r]?.(ru) ?? r)));
    return `${el.eligible ? '✅ <b>Eligible reward</b>' : '⛔ <b>Belum eligible reward</b>'}\n${rows.join('\n')}`;
  }

  // Requirement items from the server (quotes, upgrades, land) as ✅/❌ have/need lines.
  reqLines(items, indent = '   ') {
    return (items ?? []).map((i) => `${indent}${i.met ? '✅' : '❌'} ${esc(i.label)} ${num(i.have, 0)}/${num(i.need, 0)}${i.met ? '' : ` (kurang ${num(i.missing, 0)})`}`).join('\n');
  }

  takeFlash() {
    const f = this.flash;
    this.flash = null;
    return f ? `${esc(f)}\n\n` : '';
  }

  nav(...extra) {
    return [...extra, [this.btn('🏠 Dashboard', () => this.home), this.btn('🔄 Refresh', async () => { await this.e.refresh(); return this.panelScreen ?? this.home; })]];
  }

  state() { return this.e.state; }

  // ---------- screens
  async home() {
    this.panelScreen = this.home;
    const st = this.state();
    if (!st.me) await this.e.refresh();
    const { me, property: p, cats = [] } = this.state();
    const now = this.g.c.now();
    const s = this.s;
    const res = me.balances?.resources ?? {};
    const store = me.resourceStorage?.resources ?? {};
    const resLine = Object.keys(RES_ICON).map((k) => `${RES_ICON[k]}${num(res[k], 0)}<i>/${num(store[k]?.capacity, 0)}</i>`).join('  ');
    const catLines = cats.slice(0, 12).map((c) => {
      const job = p?.activeJobs?.find((j) => j.catId === c.id);
      const extra = job ? ` → ${esc(job.buildingType)} ${until(job.endsAt, now)}` : '';
      return `${RARITY_ICON[c.rarity] ?? ''} <b>${esc(c.name)}</b> L${c.level} ⚡${Math.round(c.stamina)} ${ACT_ICON[c.activity] ?? c.activity}${extra}`;
    }).join('\n');
    const rw = this.e.state.rewards;
    const ep = rw?.currentEpoch;
    const tut = st.tutorial?.active ? `\n🎓 Tutorial: <b>${esc(st.tutorial.current)}</b> (${st.tutorial.objectivesDone}/${st.tutorial.objectives.length})` : '';
    const elig = rw?.eligibility ? (rw.eligibility.eligible ? '✅ eligible reward' : `⛔ belum eligible:\n${rw.eligibility.reasons.map((r) => `   • ${esc(ELIG_TEXT[r]?.(rw.eligibility.rules) ?? r)}`).join('\n')}`) : '';
    const myPts = (rw?.pools ?? []).reduce((a, x) => a + n(x.myPoints), 0);
    const stt = this.e.stats;
    const text = `${this.takeFlash()}🐾 <b>PAWS OF SHERWOOD BOT</b>
${s.get('running') ? '🟢 <b>AUTO ON</b>' : '🔴 <b>PAUSED</b>'} · siklus terakhir ${ago(stt.lastTick)}

👤 <b>${esc(me.user?.username ?? '-')}</b> · <code>${esc(me.wallet?.address?.slice(0, 8))}…${esc(me.wallet?.address?.slice(-4))}</code>
🏡 ${esc(p?.name ?? '-')} (tier ${p?.tier ?? '-'}) · House L${me.resourceStorage?.houseLevel ?? 1}
💰 <b>${num(me.balances?.cat)} $PAWS</b>
${resLine}

🐱 <b>Kucing</b> (${p?.activeCats?.working ?? 0}/${p?.activeCats?.limit ?? '-'} kerja)
${catLines || '-'}
${tut}
${this.e.needed?.size ? `🎯 Bot sedang mengumpulkan: ${[...this.e.needed].map(([k, v]) => `${RES_ICON[k] ?? ''}${esc(k)} ${num(v, 0)}`).join(', ')} (untuk level up/upgrade)\n` : ''}🎁 Ronde #${ep?.epochNumber ?? '-'} sisa ${ep ? until(ep.endsAt, now) : '-'} · poin saya ${num(myPts)}
${elig}

📊 claim ${stt.claims} · shift ${stt.jobsStarted} · level up ${stt.levelUps} · reward ${stt.rewardsClaimed}${stt.lastError ? `\n❌ ${esc(stt.lastError)}` : ''}`;
    return {
      text,
      kb: [
        [this.btn('🔄 Refresh', async () => { await this.e.refresh(); return this.home; }),
          this.btn(s.get('running') ? '⏸ Pause' : '▶️ Start', () => { s.toggle('running'); return this.home; }),
          this.btn('⚡ Jalankan', async () => { await this.e.runNow(); this.flash = '✅ Siklus dijalankan'; return this.home; })],
        [this.btn('🐱 Kucing', () => this.catsScreen), this.btn('🏗 Bangunan', () => this.buildingsScreen), this.btn('⏱ Shift', () => this.jobsScreen)],
        [this.btn('🎁 Reward', () => this.rewardsScreen), this.btn('🛒 Market', () => this.marketScreen), this.btn('👛 Wallet', () => this.walletScreen)],
        [this.btn('📜 Permit & Rekrut', () => this.permitScreen), this.btn('🎓 Tutorial', () => this.tutorialScreen), this.btn('🏆 Leaderboard', () => this.leaderScreen)],
        [this.btn('👑 Membership', () => this.membershipScreen), this.btn('🤝 Referral', () => this.referralScreen), this.btn('🔒 Stake', () => this.stakeScreen)],
        [this.btn('⚙️ Setting', () => this.settingsScreen), this.btn('📋 Log', () => this.logScreen), this.btn('💡 Strategi Cuan', () => this.strategyScreen)],
        [this.btn('❓ Bantuan', () => this.helpScreen)],
      ],
    };
  }

  // ----- cats
  async catsScreen() {
    this.panelScreen = this.catsScreen;
    const cats = this.state().cats ?? [];
    return {
      text: `${this.takeFlash()}🐱 <b>Kucing kamu</b> (${cats.length})\nPilih kucing untuk aksi.`,
      kb: this.nav(...cats.map((c) => [this.btn(`${RARITY_ICON[c.rarity] ?? ''} ${c.name} L${c.level} ⚡${Math.round(c.stamina)} ${c.activity}`, () => this.catScreen(c.id))])),
    };
  }

  catScreen(id) {
    const ui = this;
    return async function catDetail() {
      ui.panelScreen = ui.catScreen(id);
      const c = (ui.state().cats ?? []).find((x) => x.id === id);
      if (!c) return { text: 'Kucing tidak ditemukan.', kb: ui.nav() };
      const p = ui.state().property;
      const job = p.activeJobs?.find((j) => j.catId === id);
      const qn = p.house?.quickNap;
      const q = c.level < c.levelCap ? await ui.g.upgradeQuote(id, 0).catch(() => null) : null;
      // Same choice the engine makes: lowest expected PAWS per success (free levels -> 100%).
      const pick = q ? [...q.stops].sort((a, b) => n(a.catCost) / a.chanceBps - n(b.catCost) / b.chanceBps || b.chanceBps - a.chanceBps)[0] : null;
      const lvlInfo = q ? `\n\n📈 <b>Syarat naik ke L${q.targetLevel}</b> (bot pakai peluang ${pick.chanceBps / 100}%, ${n(pick.catCost) ? `${num(pick.catCost)} PAWS` : 'gratis'})\n${ui.reqLines([{ kind: 'XP', label: 'XP', have: q.xp.current, need: q.xp.required, missing: Math.max(0, q.xp.required - q.xp.current), met: q.xp.met }, ...(q.requirements?.items ?? []).filter((i) => i.kind !== 'XP')])}${n(q.costs.catCost) === 0 ? '\n   ✅ PAWS gratis' : ''}${q.blockers.includes('CAT_BUSY') ? '\n   ⏳ menunggu kucing selesai kerja' : ''}` : '';
      const text = `${ui.takeFlash()}${RARITY_ICON[c.rarity] ?? ''} <b>${esc(c.name)}</b> ${c.isMain ? '⭐ main' : ''} ${c.isProtected ? '🛡' : ''}
<code>${esc(c.serial)}</code> · ${esc(c.rarity)} ${esc(c.profession)}
Level <b>${c.level}</b>/${c.levelCap} · XP ${c.xp}/${c.xpToNext}
⚡ Stamina ${bar(c.stamina, c.maxStamina)} ${Math.round(c.stamina)}/${c.maxStamina} (+${c.staminaRegenPerHour}/jam)
📊 prod ${c.stats.productivity} · eff ${c.stats.efficiency} · luck ${c.stats.luck} · end ${c.stats.endurance}
✨ ${c.traits.map((t) => `${esc(t.name)} (${esc(t.description)})`).join(', ') || '-'}
🎰 Jackpot ${(c.jackpotChanceBps / 100).toFixed(2)}% · kerja ${c.lifetimeWorkHours} jam
Status: ${ACT_ICON[c.activity] ?? c.activity}${job ? ` di ${esc(job.buildingType)}, selesai ${until(job.endsAt, ui.g.c.now())}` : ''}${lvlInfo}`;
      const rows = [];
      if (c.activity === 'IDLE') rows.push([ui.btn('⛏ Suruh kerja', () => ui.pickBuilding(id)), ui.btn('😴 Rest gratis', ui.doThen(`${c.name} istirahat`, () => ui.g.rest(id), ui.catScreen(id)))]);
      if (c.activity === 'IDLE' && qn) rows.push([ui.btn(`💤 Quick nap (${num(qn.catCost)} PAWS)`, ui.confirm(`Quick nap ${esc(c.name)} seharga ${num(qn.catCost)} $PAWS?`, 'Quick nap', () => ui.g.nap(id, qn.catCost), ui.catScreen(id)))]);
      rows.push([ui.btn(`📈 Level up ${c.canAttemptUpgrade ? '(siap!)' : `(XP ${c.xp}/${c.xpToNext})`}`, () => ui.levelUpScreen(id))]);
      rows.push([
        ui.btn(c.isMain ? '⭐ Main cat' : '⭐ Jadikan main', ui.doThen('Main cat diganti', () => ui.g.setMain(id), ui.catScreen(id))),
        ui.btn(c.isProtected ? '🛡 Lepas protect' : '🛡 Protect', ui.doThen('Protect diubah', () => ui.g.protect(id, !c.isProtected), ui.catScreen(id))),
        ui.btn('✏️ Rename', ui.ask(`Nama baru untuk ${esc(c.name)}:`, async (t) => { await ui.g.rename(id, t); await ui.e.refresh(); ui.flash = `✅ Rename ke ${t}`; return ui.catScreen(id); })),
      ]);
      if (c.isTradable && !c.listingId) rows.push([ui.btn('💲 Jual di market', () => ui.sellScreen(id))]);
      if (c.listingId) rows.push([ui.btn('🏷️ Batalkan listing', ui.doThen('Listing dibatalkan', () => ui.g.cancelListing(c.listingId), ui.catScreen(id)))]);
      if (c.canRelease) rows.push([ui.btn('🗑 Release (hapus)', async () => {
        const pv = await ui.g.releasePreview(id);
        return ui.confirm(`Release <b>${esc(c.name)}</b>? Kucing hilang permanen.\n${esc(JSON.stringify(pv).slice(0, 300))}`, 'Kucing di-release', () => ui.g.release(id, c.releaseNeedsTypedConfirmation ? c.name : undefined), ui.catsScreen)();
      })]);
      return { text, kb: ui.nav(...rows, [ui.btn('⬅️ Daftar kucing', () => ui.catsScreen)]) };
    };
  }

  pickBuilding(catId) {
    const ui = this;
    return async function pick() {
      const p = ui.state().property;
      const bs = p.buildings.filter((b) => b.hostsJobs && b.deployed && b.canStartJob && b.slots - b.activeJobs > 0);
      return {
        text: '🏗 Pilih bangunan untuk kerja:',
        kb: ui.nav(...bs.map((b) => [ui.btn(`${b.name} L${b.level} (${b.slots - b.activeJobs} slot, ${Math.round(b.condition)}%) ${b.rewardSymbol ? `→ ${b.rewardSymbol}` : ''}`, () => ui.pickMinutes(catId, b.id))]), [ui.btn('⬅️ Kembali', () => ui.catScreen(catId))]),
      };
    };
  }

  pickMinutes(catId, buildingId) {
    const ui = this;
    return async function minutes() {
      const ds = ui.e.cfg.jobs.durations;
      const rk = await ui.g.workerRanking(buildingId, 10);
      const o = rk.options.find((x) => x.catId === catId);
      const longest = o?.longestAffordableMinutes ?? 480;
      const rows = [];
      let row = [];
      for (const d of ds.filter((x) => x.minutes <= longest)) {
        row.push(ui.btn(`${d.minutes >= 60 ? `${d.minutes / 60}j` : `${d.minutes}m`} (-${d.staminaCost}⚡)${d.rewardEligible ? '🎁' : ''}`, ui.doThen(`Shift ${d.minutes} menit dimulai`, () => ui.g.startJob(catId, buildingId, d.minutes), ui.catScreen(catId))));
        if (row.length === 3) { rows.push(row); row = []; }
      }
      if (row.length) rows.push(row);
      return {
        text: `⏱ Pilih durasi shift\n${o ? `Perkiraan: ${num(o.perHour)}/jam${o.projection?.gamePoints ? ` · ${num(o.projection.gamePoints)} pts/10m` : ''}` : ''}\n🎁 = dapat poin reward (≥10 menit)`,
        kb: ui.nav(...rows, [ui.btn('⬅️ Kembali', () => ui.pickBuilding(catId))]),
      };
    };
  }

  levelUpScreen(catId) {
    const ui = this;
    return async function lvl() {
      const q = await ui.g.upgradeQuote(catId, 0);
      const rows = q.stops.map((s) => [ui.btn(`${s.chanceBps / 100}% · ${num(s.catCost)} PAWS`, ui.confirm(`Level up ke L${q.targetLevel} dengan peluang ${s.chanceBps / 100}% biaya ${num(s.catCost)} $PAWS + ${esc(JSON.stringify(q.costs.resources))}?`, 'Level up dimulai', () => ui.g.startUpgrade(catId, s.chanceBps / 100, s.catCost), ui.catScreen(catId)))]);
      return {
        text: `📈 <b>Level up L${q.currentLevel} → L${q.targetLevel}</b>
XP ${bar(q.xp.current, q.xp.required)} ${q.xp.current}/${q.xp.required} (kucing dapat ${ui.e.cfg.xp.perHour} XP/jam kerja)
Biaya: ${num(q.costs.catCost)} PAWS + ${esc(Object.entries(q.costs.resources).map(([k, v]) => `${v} ${k}`).join(', '))} · persiapan ${dur(q.prepSeconds)}
Peluang dasar ${q.chance.baseBps / 100}% (bisa dinaikkan sampai 100% dengan biaya lebih)
Bisa sekarang: ${q.canUpgrade ? '✅' : `⛔ ${esc(blockers(q.blockers))}`}
<b>Syarat</b>:
${ui.reqLines(q.requirements?.items)}
XP hanya didapat dari kerja shift (tidak ada item XP). L1-3 gratis (peluang 100% juga gratis); L4+ wajib PAWS + XP, PAWS bukan pengganti XP.
Gagal = PAWS &amp; resource hangus, level &amp; XP aman, peluang berikutnya +${ui.e.cfg.upgrade.resolveStepPct}% (maks +${ui.e.cfg.upgrade.resolveMaxPct}%). Bot memilih peluang dengan biaya rata-rata per sukses termurah. Auto level up: ${ui.s.get('autoLevelUp') ? 'ON' : 'OFF'}${ui.s.get('levelUpSpendPaws') ? ' (boleh bayar PAWS)' : ' (hanya yang gratis)'}
Produksi/jam: ${q.gain?.at?.perHour?.now ?? '-'} → ${q.gain?.at?.perHour?.after ?? '-'}${q.gain?.at?.points ? ` · poin/jam ${q.gain.at.points.perHour.now} → ${q.gain.at.points.perHour.after}` : ''}`,
        kb: ui.nav(...(q.canUpgrade ? rows : []), [ui.btn('⬅️ Kembali', () => ui.catScreen(catId))]),
      };
    };
  }

  sellScreen(catId) {
    const ui = this;
    return async function sell() {
      const c = ui.state().cats.find((x) => x.id === catId);
      const floor = await ui.g.marketFloor();
      const fr = n(floor.byRarity?.[c.rarity]);
      const fp = n(floor.byProfession?.[c.profession]);
      const list = (price) => ui.confirm(`Jual <b>${esc(c.name)}</b> seharga <b>${num(price)} $PAWS</b>? (fee ${floor.feeBps / 100}%, terima ±${num(price * (1 - floor.feeBps / 10000))})`, `Listing ${num(price)} PAWS`, () => ui.g.listCat(catId, price.toFixed(2)), ui.catScreen(catId));
      const opts = [fr * 0.95, fr, fr * 1.1, fr * 1.25].filter((x) => x >= 1);
      return {
        text: `💲 <b>Jual ${esc(c.name)}</b> (${c.rarity} ${c.profession} L${c.level})\nFloor ${c.rarity}: <b>${num(fr)}</b> · floor ${c.profession}: ${num(fp)}\nPilih harga cepat atau ketik sendiri.`,
        kb: ui.nav(
          opts.map((x) => ui.btn(`${num(x, 0)}`, list(Math.round(x)))),
          [ui.btn('✏️ Harga custom', ui.ask('Harga jual dalam $PAWS (contoh 1250):', async (t) => {
            const price = Number(t.replace(',', '.'));
            if (!(price >= 1)) throw new Error('Harga tidak valid');
            await ui.g.listCat(catId, price.toFixed(2));
            await ui.e.refresh();
            ui.flash = `✅ ${c.name} dijual ${price} PAWS`;
            return ui.catScreen(catId);
          }))],
          [ui.btn('⬅️ Kembali', () => ui.catScreen(catId))],
        ),
      };
    };
  }

  // ----- buildings
  async buildingsScreen() {
    this.panelScreen = this.buildingsScreen;
    const p = this.state().property;
    const nt = p.nextTier;
    const lines = p.buildings.map((b) => `• <b>${esc(b.name)}</b> L${b.level} ${b.deployed ? '' : '📦'} · ${Math.round(b.condition)}% · ${b.activeJobs}/${b.slots} slot${b.producesResource ? ` · ${RES_ICON[b.producesResource] ?? ''}` : ''}${b.rewardSymbol ? ` · 🎁${b.rewardSymbol} ${b.gamePointsPerHour}pts/j` : ''}${b.status !== 'ACTIVE' ? ` · ${b.status} ${b.secondsRemaining ? dur(b.secondsRemaining) : ''}` : ''}`);
    const req = nt?.requirements?.items?.filter((i) => !i.met).map((i) => `${i.label} ${num(i.have)}/${num(i.need)}`).join(', ');
    const plan = this.e.growPlan().slice(0, 3).map((x, i) => `${i + 1}. ${esc(x.name)} – ${num(x.cost)} PAWS ${x.ready ? '✅' : '⏳'}`).join('\n');
    const freeSlots = (p.activeCats?.limit ?? 0) - (this.state().cats?.length ?? 0);
    return {
      text: `${this.takeFlash()}🏗 <b>Bangunan</b> · ${esc(p.name)} ${p.size}x${p.size}\n${lines.join('\n')}\n\n🏡 Perluas ke <b>${esc(nt?.name ?? '-')}</b>: ${nt ? (nt.requirements.met ? '✅ bisa' : `⛔\n${this.reqLines(nt.requirements.items)}`) : 'maks'}
🐱 Slot kucing kosong: <b>${Math.max(0, freeSlots)}</b>${freeSlots > 0 ? ' (beli kucing di Market = poin bertambah paling besar)' : ''}
🎯 <b>Target Auto Grow</b> (${this.s.get('autoUpgradeBuildings') ? 'ON' : 'OFF'}):\n${plan || '-'}`,
      kb: this.nav(
        ...p.buildings.map((b) => [this.btn(`${b.name} L${b.level}`, () => this.buildingScreen(b.id))]),
        ...(nt?.requirements?.met ? [[this.btn(`🏡 Perluas lahan (${num(nt.catCost)} PAWS)`, this.confirm(`Perluas ke ${esc(nt.name)} seharga ${num(nt.catCost)} $PAWS + resource?`, 'Perluasan dimulai', () => this.g.expand(nt.catCost), this.buildingsScreen))]] : []),
      ),
    };
  }

  buildingScreen(id) {
    const ui = this;
    return async function bd() {
      ui.panelScreen = ui.buildingScreen(id);
      const p = ui.state().property;
      const b = p.buildings.find((x) => x.id === id);
      if (!b) return { text: 'Bangunan tidak ditemukan', kb: ui.nav() };
      const isHouse = b.type === 'HOUSE';
      const nl = isHouse ? p.house?.nextLevel : b.nextLevel;
      const miss = nl?.requirements?.items?.filter((i) => !i.met).map((i) => `${i.label} ${num(i.have)}/${num(i.need)}`).join(', ');
      const text = `${ui.takeFlash()}🏗 <b>${esc(b.name)}</b> (${b.rarity}) L${b.level}
Status ${b.status} · kondisi ${bar(b.condition, 100)} ${b.condition}%
Slot ${b.activeJobs}/${b.slots} · profesi cocok ${esc(b.preferredProfession ?? '-')}
${b.producesResource ? `Produksi ${RES_ICON[b.producesResource]} ${b.producesResource}` : ''}${b.rewardSymbol ? ` · Reward ${b.rewardSymbol} (${b.pointsCategory}) ${b.gamePointsPerHour} pts/jam` : ''}
${isHouse ? `House: nap ${p.house.quickNap.minutes}m (${num(p.house.quickNap.catCost)} PAWS), rest gratis ${p.house.freeRest.minutes}m +${p.house.freeRest.staminaRestored}⚡\n` : ''}Upgrade → L${nl?.level ?? '-'}: ${nl ? `${num(nl.catCost)} PAWS ${nl.requirements?.met ? '✅ siap' : '⛔'}\n${ui.reqLines(nl.requirements?.items)}` : 'maks'}
${nl?.unlocks ? `Buka: ${esc(nl.unlocks.join(', '))}` : ''}`;
      const rows = [];
      if (nl?.requirements?.met) rows.push([ui.btn(`⬆️ Upgrade (${num(nl.catCost)} PAWS)`, ui.confirm(`Upgrade ${esc(b.name)} ke L${nl.level} seharga ${num(nl.catCost)} $PAWS?`, 'Upgrade dimulai', () => ui.g.upgradeBuilding(b.id, nl.catCost), ui.buildingScreen(id)))]);
      if (b.repair?.needed) rows.push([ui.btn(`🛠 Repair (${num(b.repair.catCost)} PAWS)`, ui.confirm(`Repair ${esc(b.name)} seharga ${num(b.repair.catCost)} $PAWS + ${esc(JSON.stringify(b.repair.resources))}?`, 'Repair dimulai', () => ui.g.repair(b.id, b.repair.catCost), ui.buildingScreen(id)))]);
      if (b.emergencyRepair?.available) rows.push([ui.btn('🚑 Emergency repair (gratis)', ui.doThen('Emergency repair', () => ui.g.emergencyRepair(b.id, b.emergencyRepair.catCost), ui.buildingScreen(id)))]);
      if (b.status === 'UPGRADING' && b.secondsRemaining === 0) rows.push([ui.btn('✅ Claim upgrade', ui.doThen('Upgrade diklaim', () => ui.g.claimBuildingUpgrade(b.id), ui.buildingScreen(id)))]);
      const edit = [];
      if (b.canRotate) edit.push(ui.btn('🔄 Putar', ui.doThen('Diputar', () => ui.g.rotate(b.id, 1), ui.buildingScreen(id))));
      if (b.canStore) edit.push(ui.btn('📦 Simpan', ui.confirm(`Simpan ${esc(b.name)} ke storage? (bisa dipasang lagi)`, 'Disimpan', () => ui.g.store(b.id), ui.buildingsScreen)));
      if (!b.deployed) edit.push(ui.btn('📍 Pasang', async () => { await ui.e.deployStored(); return ui.buildingsScreen; }));
      if (edit.length) rows.push(edit);
      return { text, kb: ui.nav(...rows, [ui.btn('⬅️ Bangunan', () => ui.buildingsScreen)]) };
    };
  }

  // ----- jobs
  async jobsScreen() {
    this.panelScreen = this.jobsScreen;
    const p = this.state().property;
    const now = this.g.c.now();
    const jobs = p.activeJobs ?? [];
    const lines = jobs.map((j) => `• <b>${esc(j.catName)}</b> @ ${esc(j.buildingType)} ${j.durationMinutes}m → ${j.claimable || new Date(j.endsAt) <= now ? '✅ siap claim' : `⏳ ${until(j.endsAt, now)}`}${j.snapshot?.resource ? ` · ${j.snapshot.resource.amount} ${j.snapshot.resource.type}` : ''}${n(j.snapshot?.gamePoints) ? ` · ${num(j.snapshot.gamePoints)} pts` : ''}`);
    const rows = [];
    for (const j of jobs) {
      const r = [];
      if (j.claimable || new Date(j.endsAt) <= now) r.push(this.btn(`✅ Claim ${j.catName}`, this.doThen('Claim', () => this.g.claimJob(j.id, this.s.get('dropOverflow')), this.jobsScreen)));
      if (j.cancellable) r.push(this.btn(`❌ Batal ${j.catName}`, this.confirm(`Batalkan shift ${esc(j.catName)}? ${j.cancelRefundsStamina ? '(stamina kembali)' : '(stamina hangus)'}`, 'Shift dibatalkan', () => this.g.cancelJob(j.id), this.jobsScreen)));
      if (j.fastTrack?.available) {
        const cost = j.fastTrack.free ? '0.000000000000000000' : j.fastTrack.catCost;
        r.push(this.btn(`⚡ Fast ${j.fastTrack.free ? 'GRATIS' : `${num(cost)}`}`, this.confirm(`Fast track ${esc(j.catName)} (-75% waktu) seharga ${num(cost)} $PAWS?`, 'Fast track', () => this.g.fastTrack(j.id, cost), this.jobsScreen)));
      }
      if (r.length) rows.push(r);
    }
    return { text: `${this.takeFlash()}⏱ <b>Shift aktif</b> (${jobs.length})\n${lines.join('\n') || 'Tidak ada shift.'}`, kb: this.nav(...rows) };
  }

  // ----- rewards
  async rewardsScreen() {
    this.panelScreen = this.rewardsScreen;
    const rw = await this.g.rewards();
    this.e.state.rewards = rw;
    const now = this.g.c.now();
    const pools = rw.pools.map((x) => `• <b>${x.symbol}</b> ${esc(x.category)}: ${num(x.myPoints)} / ${num(x.totalPoints, 0)} pts · share ${x.estimatedSharePct}% · hadiah ${num(x.epochRewardAmount, 4)} ${x.symbol} (~$${num(x.prizeQuote)})`).join('\n');
    const cp = rw.catPool;
    const allocs = (rw.allocations ?? []).slice(0, 12).map((a) => `• R#${a.epochNumber} ${esc(a.symbol)} <b>${num(a.amount, 6)}</b> · ${esc(a.status)}${a.collect ? `/${esc(a.collect)}` : ''}${a.ineligibleReason ? ` ⛔${esc(a.ineligibleReason)}` : ''}`).join('\n');
    const earned = await this.g.rewardsEarned().catch(() => null);
    const el = rw.eligibility;
    return {
      text: `${this.takeFlash()}🎁 <b>Reward ronde #${rw.currentEpoch.epochNumber}</b> · sisa ${until(rw.currentEpoch.endsAt, now)}
${await this.eligibilityChecklist(rw)}

${pools}
🐾 <b>$PAWS pool</b>: ${num(cp?.myPoints)} / ${num(cp?.totalPoints, 0)} pts · total ${num(cp?.amount, 0)} PAWS · share ${cp?.estimatedSharePct ?? '-'}%
${rw.membership?.available ? `👑 Membership ${num(rw.membership.price)} ${rw.membership.quoteAsset}/${rw.membership.durationDays} hari ${rw.membership.member ? '(aktif)' : ''}` : ''}

💵 Total didapat: saham $${num(earned?.stockUsd)} · PAWS ${num(earned?.paws)}${n(earned?.creatorUsd) ? ` · creator $${num(earned.creatorUsd)}` : ''}

<b>Alokasi</b> (${this.e.pendingAllocations(rw).length} menunggu claim):\n${allocs || '-'}
<i>Saham (AAPL, COST, TSLA, ...) dikirim ke wallet lewat transaksi claim on-chain (gas ETH kecil).</i>`,
      kb: this.nav([this.btn('💰 Claim & collect semua', async () => { const d = await this.e.claimRewards(true); this.flash = d.length ? `✅ ${d.length} reward diproses` : 'ℹ️ Tidak ada reward yang bisa di-claim'; return this.rewardsScreen; }),
        this.btn(`Auto collect on-chain: ${this.s.get('autoCollectOnchain') ? 'ON' : 'OFF'}`, () => { this.s.toggle('autoCollectOnchain'); return this.rewardsScreen; })],
      [this.btn('👑 Membership', () => this.membershipScreen), this.btn('✍️ Creator', () => this.creatorScreen)]),
    };
  }

  // ----- market
  async marketScreen() {
    this.panelScreen = this.marketScreen;
    const [floor, mine] = await Promise.all([this.g.marketFloor(), this.g.marketMine()]);
    const fl = Object.entries(floor.byRarity).map(([k, v]) => `${RARITY_ICON[k]} ${k}: <b>${v ? num(v) : '-'}</b>`).join('\n');
    const myl = (mine.listings ?? []).map((l) => `• ${esc(l.cat?.name)} ${l.cat?.rarity} @ ${num(l.price)} ${l.status}`).join('\n');
    return {
      text: `${this.takeFlash()}🛒 <b>Marketplace</b> · ${floor.activeListings} listing · fee ${floor.feeBps / 100}%\n<i>Market game ini menjual kucing. $PAWS dibeli di Wallet → Beli PAWS, permit di Permit Office.</i>\n\n<b>Floor per rarity</b>\n${fl}\n\n<b>Floor per profesi</b>\n${Object.entries(floor.byProfession).map(([k, v]) => `${esc(k)}: ${v ? num(v) : '-'}`).join(' · ')}\n\n<b>Listing saya</b>\n${myl || '-'}\n💰 Saldo: ${num(this.state().me.balances.cat)} PAWS`,
      kb: this.nav(
        [this.btn('🔍 Semua listing (filter)', () => this.browse({ sort: 'price_asc' }))],
        [this.btn('💸 Termurah', () => this.browse({ sort: 'price_asc' })), this.btn('🆕 Terbaru', () => this.browse({ sort: 'newest' })), this.btn('💪 Stat tertinggi', () => this.browse({ sort: 'stats_desc' }))],
        ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'].map((r) => this.btn(RARITY_ICON[r], () => this.browse({ sort: 'price_asc', rarity: r }))),
        [this.btn('💲 Jual kucing', () => this.catsScreen), this.btn('📈 Penjualan terakhir', () => this.recentSales)],
        ...(mine.listings ?? []).filter((l) => l.status === 'ACTIVE').map((l) => [this.btn(`🏷️ Batal jual ${l.cat?.name} (${num(l.price)})`, this.doThen('Listing dibatalkan', () => this.g.cancelListing(l.id), this.marketScreen))]),
      ),
    };
  }

  // Marketplace browser. Server filters (verified): sort, rarity, profession, minLevel, q, page, limit.
  browse(params) {
    const ui = this;
    const PER = 8;
    return async function br() {
      const p = { sort: 'price_asc', page: 1, ...params };
      ui.panelScreen = ui.browse(p);
      const r = await ui.g.market({ ...p, limit: PER });
      const ls = r.listings ?? [];
      const pages = Math.max(1, Math.ceil((r.total ?? 0) / PER));
      const lines = ls.map((l, i) => `${i + 1}. ${RARITY_ICON[l.cat.rarity]} <b>${esc(l.cat.name)}</b> ${l.cat.rarity} ${l.cat.profession} L${l.cat.level}${l.isMine ? ' (punyamu)' : ''}
    📊 p${l.cat.stats.productivity} e${l.cat.stats.efficiency} l${l.cat.stats.luck} n${l.cat.stats.endurance}${l.cat.traits?.length ? ` · ✨${l.cat.traits.map((t) => esc(t.name)).join(', ')}` : ''}
    💰 <b>${num(l.price)}</b> PAWS · ${esc(l.sellerUsername)}`);
      const set = (patch) => () => ui.browse({ ...p, page: 1, ...patch });
      const filt = [p.rarity && `rarity ${p.rarity}`, p.profession && `profesi ${p.profession}`, p.minLevel && `L${p.minLevel}+`, p.q && `"${p.q}"`].filter(Boolean).join(' · ') || 'semua';
      const SORTS = { price_asc: 'Termurah', price_desc: 'Termahal', newest: 'Terbaru', level_desc: 'Level ↓', stats_desc: 'Stat ↓', productivity_desc: 'Prod ↓', luck_desc: 'Luck ↓' };
      const sortKeys = Object.keys(SORTS);
      return {
        text: `🛒 <b>Marketplace</b> · ${esc(SORTS[p.sort] ?? p.sort)} · ${esc(filt)}\n${r.total ?? 0} listing · hal ${p.page}/${pages} · saldo ${num(ui.state().me.balances.cat)} PAWS\n\n${lines.join('\n') || 'Kosong'}`,
        kb: ui.nav(
          ...ls.filter((l) => !l.isMine).map((l) => [ui.btn(`🛍 Beli ${l.cat.name} – ${num(l.price)}`, ui.confirm(`Beli <b>${esc(l.cat.name)}</b> (${l.cat.rarity} ${l.cat.profession} L${l.cat.level}) seharga <b>${num(l.price)} $PAWS</b>?\nSaldo: ${num(ui.state().me.balances.cat)}\n<i>Kucing baru butuh aklimasi sebentar sebelum bisa kerja.</i>`, `Beli ${l.cat.name}`, () => ui.g.buyListing(l.id), ui.catsScreen))]),
          [...(p.page > 1 ? [ui.btn('◀️ Sebelumnya', () => ui.browse({ ...p, page: p.page - 1 }))] : []), ...(r.hasMore ? [ui.btn('Berikutnya ▶️', () => ui.browse({ ...p, page: p.page + 1 }))] : [])],
          [ui.btn(`↕️ ${SORTS[sortKeys[(sortKeys.indexOf(p.sort) + 1) % sortKeys.length]]}`, set({ sort: sortKeys[(sortKeys.indexOf(p.sort) + 1) % sortKeys.length] })), ui.btn('🔎 Cari nama', ui.ask('Nama kucing yang dicari:', async (t) => ui.browse({ ...p, page: 1, q: t.trim() }))), ui.btn('🧹 Reset', () => ui.browse({ sort: p.sort }))],
          ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'].map((x) => ui.btn(`${RARITY_ICON[x]}${p.rarity === x ? '✓' : ''}`, set({ rarity: p.rarity === x ? undefined : x }))),
          [['LUMBERJACK', '🪓'], ['FARMER', '🌾'], ['MINER', '⛏'], ['ENGINEER', '🔧'], ['MERCHANT', '💼'], ['ENERGY_WORKER', '⚡']].map(([x, ic]) => ui.btn(`${ic}${p.profession === x ? '✓' : ''}`, set({ profession: p.profession === x ? undefined : x }))),
          [3, 5, 10, 20].map((lv) => ui.btn(`L${lv}+${p.minLevel === lv ? '✓' : ''}`, set({ minLevel: p.minLevel === lv ? undefined : lv }))),
          [ui.btn('⬅️ Market', () => ui.marketScreen)],
        ),
      };
    };
  }

  async recentSales() {
    const r = await this.g.marketRecent();
    const lines = (r.sales ?? []).slice(0, 12).map((s) => `• ${RARITY_ICON[s.rarity] ?? ''} ${esc(s.catName)} ${s.rarity} ${s.profession} L${s.level} → <b>${num(s.price)}</b> · ${ago(s.createdAt)}`);
    return { text: `📈 <b>Penjualan terakhir</b>\n${lines.join('\n') || '-'}`, kb: this.nav([this.btn('⬅️ Market', () => this.marketScreen)]) };
  }

  // ----- wallet
  async walletScreen() {
    this.panelScreen = this.walletScreen;
    const ch = this.e.chain;
    const [w, act, ref, bal, price] = await Promise.all([
      this.g.wallet(), this.g.walletActivity(), this.g.referrals().catch(() => null),
      ch.balances().catch((e) => ({ error: e.shortMessage ?? e.message })), ch.pawsPrice().catch(() => null),
    ]);
    const onchain = bal.error ? `⚠️ RPC: ${esc(bal.error.slice(0, 120))}` : `⛽ ETH <b>${num(bal.eth, 6)}</b> · 🪙 PAWS <b>${num(bal.paws)}</b> · 💵 USDG <b>${num(bal.usdg)}</b>`;
    const gameBal = n(w.gameBalance);
    const rows = [
      [this.btn('🛒 Beli PAWS (ETH)', () => this.buyScreen('eth')), this.btn('🛒 Beli PAWS (USDG)', () => this.buyScreen('usdg'))],
      [this.btn('⬇️ Deposit wallet → game', this.ask(`Jumlah PAWS dari wallet ke game (saldo wallet ${num(bal.paws)}), atau ketik <b>all</b>:`, async (t) => {
        const amt = t.trim().toLowerCase() === 'all' ? bal.raw?.paws : t.trim();
        if (!amt || (typeof amt === 'string' && !(Number(amt) > 0))) throw new Error('Jumlah tidak valid');
        return this.confirm(`Deposit ${typeof amt === 'bigint' ? num(bal.paws) : esc(amt)} PAWS ke game? (2 transaksi: approve + deposit, gas ETH kecil)`, 'Deposit selesai', async () => { const r = await ch.deposit(amt, (m) => this.notify(m)); this.notify(r.credited ? `✅ Deposit dikreditkan. Tx ${ch.explorerTx(r.txHash)}` : `⏳ ${r.pendingNote} Tx ${ch.explorerTx(r.txHash)}`); }, this.walletScreen)();
      }))],
      [this.btn(`⬆️ Withdraw game → wallet (min ${num(w.withdrawal.minAmount)})`, this.ask(`Jumlah PAWS yang ditarik ke wallet (saldo game ${num(gameBal)}, minimal ${num(w.withdrawal.minAmount)}):`, async (t) => {
        const amt = Number(t);
        if (!(amt >= n(w.withdrawal.minAmount))) throw new Error(`Minimal withdraw ${num(w.withdrawal.minAmount)} PAWS`);
        if (amt > gameBal) throw new Error('Saldo game tidak cukup');
        return this.confirm(`Withdraw ${num(amt)} PAWS ke <code>${esc(w.address)}</code>?`, 'Withdraw diajukan', async () => { const r = await ch.withdraw(t.trim()); this.notify(`Withdraw ${r.status ?? ''}${r.holdReason ? ` (${r.holdReason})` : ''}`); }, this.walletScreen)();
      }))],
      [this.btn('🔒 Stake PAWS', () => this.stakeScreen), this.btn('👑 Membership', () => this.membershipScreen)],
      [this.btn('✍️ Creator (X)', () => this.creatorScreen), this.btn('🤝 Trade P2P', () => this.tradesScreen)],
      [{ text: '🔗 Explorer', url: `${w.chain.explorerUrl}/address/${w.address}` }],
    ];
    return {
      text: `${this.takeFlash()}👛 <b>Wallet</b> (${esc(w.chain.name)})
Alamat: <code>${esc(w.address)}</code>
🎮 Saldo game: <b>${num(w.gameBalance)} PAWS</b>
${onchain}
💱 Harga: 1 PAWS ≈ <b>${price ? price.toFixed(6) : '-'}</b> USDG${price ? ` (1 USDG ≈ ${num(1 / price, 0)} PAWS)` : ''}
⏳ Pending withdraw ${num(w.pendingWithdrawals)} · deposit belum final ${num(w.unfinalisedDeposits)}
Vault ${w.vault.solvent ? '✅ solvent' : '⚠️'} · deposit ${w.depositsEnabled ? 'ON' : 'OFF'} · withdraw ${w.withdrawalsEnabled ? 'ON' : `OFF ${esc(w.withdrawalsPausedReason ?? '')}`}
${(act.deposits ?? []).slice(0, 3).map((d) => `• deposit ${num(d.confirmedAmount ?? d.expectedAmount)} ${esc(d.status)}`).join('\n')}${(act.withdrawals ?? []).slice(0, 3).map((d) => `\n• withdraw ${num(d.amount)} ${esc(d.status)}`).join('')}
${ref ? `🤝 <b>Referral</b> ${esc(ref.code)} · ${ref.referredCount} teman · ${ref.rateBps / 100}% · earned ${num(ref.totals.earned)} PAWS\n${esc(ref.url)}` : ''}`,
      kb: this.nav(...rows),
    };
  }

  buyScreen(pay) {
    const ui = this;
    return async function buy() {
      ui.panelScreen = ui.buyScreen(pay);
      const ch = ui.e.chain;
      await ch.init();
      const lim = ch.setup.limits;
      const bal = await ch.balances();
      const presets = pay === 'eth' ? ['0.0004', '0.0005', '0.001', '0.002'] : ['1', '5', '10', '50'];
      const go = (amt) => async () => {
        const q = pay === 'eth' ? await ch.quoteEth(parseUnits(amt, 18)) : await ch.quoteUsdg(parseUnits(amt, ch.setup.usdg.decimals));
        if (!q.out) throw new Error('Pool tidak bisa quote jumlah itu');
        return ui.confirm(`Beli PAWS dengan <b>${esc(amt)} ${pay.toUpperCase()}</b>${pay === 'eth' ? ` (≈${formatUnits(q.usdgOut, 6)} USDG)` : ''}\nDapat ±<b>${num(formatUnits(q.out, 18))} PAWS</b> (min ${num(formatUnits(q.minOut, 18))}, slippage ${lim.defaultSlippageBps / 100}%)\nFee game ${q.feeBps / 100}% · impact ${(q.impactBps / 100).toFixed(2)}%\nLalu otomatis di-deposit ke saldo game.\n\n<i>${esc(ch.setup.riskLine)}</i>`, 'Beli PAWS selesai', async () => {
          const r = await ch.buyAndDeposit(pay, amt, (m) => ui.notify(m));
          ui.notify(`✅ Dapat ${num(r.received)} PAWS. Swap ${ch.explorerTx(r.swapHash)}${r.txHash ? `\nDeposit ${ch.explorerTx(r.txHash)} ${r.credited ? '(dikreditkan)' : '(menunggu)'}` : ''}`);
        }, ui.walletScreen)();
      };
      return {
        text: `🛒 <b>Beli $PAWS pakai ${pay.toUpperCase()}</b>\nSaldo: ETH ${num(bal.eth, 6)} · USDG ${num(bal.usdg)}\nBatas per transaksi ${lim.minUsdg}-${lim.maxUsdg} USDG. Sisakan ETH sedikit untuk gas.`,
        kb: ui.nav(presets.map((p) => ui.btn(`${p} ${pay.toUpperCase()}`, go(p))), [ui.btn('✏️ Jumlah custom', ui.ask(`Jumlah ${pay.toUpperCase()} untuk beli PAWS:`, async (t) => { if (!(Number(t) > 0)) throw new Error('Jumlah tidak valid'); return go(t.trim())(); }))], [ui.btn('⬅️ Wallet', () => ui.walletScreen)]),
      };
    };
  }

  async referralScreen() {
    this.panelScreen = this.referralScreen;
    const r = await this.g.referrals();
    const sc = r.statusCounts;
    const players = (r.referredPlayers ?? []).slice(0, 10).map((p) => `• ${esc(p.username ?? '(belum ada nama)')} · ${esc(p.status)} · ${ago(p.joinedAt)}`).join('\n');
    const earn = (r.earnings ?? []).slice(0, 5).map((e) => `• +${num(e.amount)} PAWS ${esc(e.status ?? '')}`).join('\n');
    const ms = (r.milestones ?? []).map((m) => `• ${esc(m.id ?? m.milestone ?? '')} ${esc(m.status ?? '')}`).join('\n');
    const share = `https://t.me/share/url?url=${encodeURIComponent(r.url)}&text=${encodeURIComponent('Main Paws of Sherwood, kucingmu kerja & dibayar saham ter-tokenisasi 🐾')}`;
    return {
      text: `${this.takeFlash()}🤝 <b>Referral</b>
Kode: <code>${esc(r.code)}</code>
Link: ${esc(r.url)}
Komisi: <b>${r.rateBps / 100}%</b> dari $PAWS yang dibelanjakan teman
Teman: <b>${r.referredCount}</b> (pending ${sc.pending} · review ${sc.review} · approved ${sc.approved} · rejected ${sc.rejected})
Pendapatan: earned ${num(r.totals.earned)} · held ${num(r.totals.held)} · released ${num(r.totals.released)} PAWS
Household: ${r.household.active ? `✅ aktif +${r.household.bonusBps / 100}% luck` : '❌'} (${r.household.partners.length} partner aktif ${r.household.activeDays} hari)
Ticket: 1 per ${num(r.ticketRules.spendEvery)} PAWS belanja teman · ${r.ticketRules.perMembership} per membership

<b>Teman</b>\n${players || '-'}
${earn ? `\n<b>Pendapatan terakhir</b>\n${earn}` : ''}${ms ? `\n<b>Milestone</b>\n${ms}` : ''}`,
      kb: this.nav(
        [{ text: '📤 Bagikan link', url: share }],
        [this.btn('✏️ Ganti kode referral', this.ask('Kode referral baru (3-16 huruf/angka, contoh RYGROUP):\n⚠️ Kalau diganti, link lama tidak berlaku lagi dan REFERRAL_CODE di installer/.env harus ikut diganti.', async (t) => {
          const code = t.trim().toUpperCase();
          if (!/^[A-Z0-9]{3,16}$/.test(code)) throw new Error('Kode harus 3-16 huruf/angka');
          return this.confirm(`Ganti kode referral jadi <code>${esc(code)}</code>?`, `Kode referral jadi ${code}`, () => this.g.setReferralCode(code), this.referralScreen)();
        }))],
      ),
    };
  }

  async stakeScreen() {
    this.panelScreen = this.stakeScreen;
    const st = await this.g.stakes();
    const now = this.g.c.now();
    const mx = st.matrix;
    const tiers = mx.tiers.map((t) => `• ${esc(t.label)}: ${t.benefits.filter((b) => mx.lockDays.includes(b.days)).map((b) => `${b.days}h → bangun -${b.constructionReductionBps / 100}% rekrut -${b.recruitmentReductionBps / 100}%`).join(', ')}`).join('\n');
    const mine = st.stakes.map((s) => `• ${num(s.amount)} PAWS ${s.tierDays} hari · buka ${until(s.unlocksAt ?? s.unlockAt, now)} ${esc(s.status ?? '')}`).join('\n');
    const rows = mx.lockDays.map((d) => [this.btn(`🔒 Stake ${d} hari`, this.ask(`Jumlah PAWS yang di-stake ${d} hari (min ${num(mx.minStakeAmount)}, saldo game ${num(this.state().me.balances.cat)}):`, async (t) => {
      if (!(Number(t) >= n(mx.minStakeAmount))) throw new Error(`Minimal stake ${num(mx.minStakeAmount)}`);
      return this.confirm(`Stake ${esc(t)} PAWS terkunci ${d} hari? ${mx.allowEarlyUnstake ? '' : '(tidak bisa ditarik lebih awal)'}`, 'Stake dibuat', () => this.g.stake({ amount: t.trim(), tierDays: d }), this.stakeScreen)();
    }))]);
    for (const s of st.stakes) if (s.unstakeable || s.canUnstake || s.status === 'UNLOCKED') rows.push([this.btn(`🔓 Tarik ${num(s.amount)}`, this.doThen('Unstake', () => this.g.unstake(s.id), this.stakeScreen))]);
    return {
      text: `${this.takeFlash()}🔒 <b>Staking PAWS</b>\nTotal stake: ${num(st.totalStaked)} · benefit sekarang: bangun -${st.benefit.constructionReductionBps / 100}% rekrut -${st.benefit.recruitmentReductionBps / 100}%\n${st.paysRewards ? '' : '<i>Staking tidak membayar bunga, tapi memotong waktu bangun/rekrut dan memenuhi syarat "stake" reward.</i>'}\n\n${tiers}\n\n<b>Stake saya</b>\n${mine || '-'}`,
      kb: this.nav(...rows, [this.btn('⬅️ Wallet', () => this.walletScreen)]),
    };
  }

  async membershipScreen() {
    this.panelScreen = this.membershipScreen;
    const m = await this.g.membership();
    const lr = m.lastRound;
    return {
      text: `${this.takeFlash()}👑 <b>Membership</b> (pass bulanan)
Harga <b>${num(m.price)} ${esc(m.quoteAsset)}</b> / ${m.durationDays} hari
Status: ${m.member ? `✅ aktif sampai ${esc(m.memberUntil)}` : '❌ belum member'}
Member dapat pool khusus member (${m.membersPoolBps / 100}% dari pool reward member).
Ronde #${lr?.epochNumber ?? '-'}: ${lr?.members ?? '-'} member · median dapat ${num(lr?.medianPaws)} PAWS + $${esc(lr?.medianStockUsd ?? '-')} saham per ronde
Bayar dari wallet bot (USDG on-chain, butuh sedikit ETH untuk gas).`,
      kb: this.nav(
        ...(m.available && m.payment ? [[this.btn(`👑 Beli membership ${num(m.price)} ${m.quoteAsset}`, this.confirm(`Bayar ${num(m.price)} ${esc(m.quoteAsset)} untuk membership ${m.durationDays} hari?`, 'Membership aktif', async () => { const r = await this.e.chain.buyMembership(); this.notify(`👑 Membership: ${r.membership?.member ? 'aktif' : 'diproses'} · tx ${this.e.chain.explorerTx(r.txHash)}`); }, this.membershipScreen))]] : []),
        [this.btn('⬅️ Wallet', () => this.walletScreen)],
      ),
    };
  }

  async creatorScreen() {
    this.panelScreen = this.creatorScreen;
    const cr = await this.g.creator();
    const wk = cr.week;
    const subs = (cr.submissions ?? []).slice(0, 5).map((s) => `• ${esc(s.status)} ${s.tier ?? ''} ${s.points ?? ''}pts ${esc(s.postUrl)}`).join('\n');
    const rows = [];
    if (!cr.profile) rows.push([this.btn('📝 Daftar creator (ID, 18+)', this.confirm('Daftar creator program dengan negara Indonesia (ID), menyatakan 18+ dan setuju syarat game?', 'Terdaftar creator', () => this.g.creatorJoin('ID', true, true), this.creatorScreen))]);
    if (!cr.connection) rows.push([this.btn('🔗 Hubungkan akun X', async () => { const r = await this.g.creatorConnectX(); await this.send(`Buka link ini untuk menghubungkan X:\n${esc(r.authorizeUrl ?? JSON.stringify(r))}`); return this.creatorScreen; })]);
    else rows.push([this.btn(`❌ Putus X @${cr.connection.username}`, this.confirm('Putuskan akun X?', 'X diputus', () => this.g.creatorDisconnectX(), this.creatorScreen))]);
    if (wk?.submissionsOpen) rows.push([this.btn('📤 Kirim link post X', this.ask('Kirim URL post X kamu tentang Paws of Sherwood:', async (t) => { await this.g.creatorSubmit(t.trim()); this.flash = '✅ Post dikirim'; return this.creatorScreen; }))]);
    return {
      text: `${this.takeFlash()}✍️ <b>Creator program</b> → hadiah token <b>${esc(cr.asset?.symbol)}</b> (${esc(cr.asset?.displayName)})
Ronde ${wk?.weekNumber ?? '-'} · pool ${num(wk?.poolUnits, 4)} ${esc(wk?.symbol ?? '')} (+${num(wk?.pendingQuote)} ${esc(wk?.quoteAsset ?? '')}) · total ${wk?.totalPoints ?? 0} pts · tutup ${until(wk?.submissionsCloseAt, this.g.c.now())}
Maks ${cr.maxPerCreatorRound} post/ronde, umur post ≤ ${cr.maxPostAgeHours} jam
Profil: ${cr.profile ? '✅' : '❌'} · X: ${cr.connection ? `@${esc(cr.connection.username)}` : '❌'}${cr.blocked ? ` · ⛔ ${esc(cr.blocked)}` : ''}

${subs || 'Belum ada submission.'}`,
      kb: this.nav(...rows, [this.btn('⬅️ Wallet', () => this.walletScreen)]),
    };
  }

  async tradesScreen() {
    this.panelScreen = this.tradesScreen;
    const tr = await this.g.trades();
    const rows = [];
    const lines = (tr.trades ?? []).slice(0, 8).map((t) => {
      if (t.canConfirm) rows.push([this.btn(`✅ Setujui trade ${t.id.slice(0, 6)}`, this.confirm(`Setujui trade ini?\n${esc(JSON.stringify(t.summary ?? { offer: t.offer, request: t.request }).slice(0, 600))}`, 'Trade disetujui', () => this.g.confirmTrade(t.id, t.summaryHash), this.tradesScreen))]);
      if (['OPEN', 'PENDING', 'PROPOSED'].includes(t.status)) rows.push([this.btn(`❌ Batal trade ${t.id.slice(0, 6)}`, this.doThen('Trade dibatalkan', () => this.g.cancelTrade(t.id), this.tradesScreen))]);
      return `• ${esc(t.status)} dengan ${esc(t.counterparty?.username ?? t.counterpartyUsername ?? '?')} · ${esc(t.viewerRole ?? '')}`;
    });
    rows.push([this.btn('➕ Tawarkan PAWS untuk kucing pemain', this.ask('Username pemain tujuan:', async (u) => {
      const res = await this.g.searchUsers(u.trim());
      const user = (res.users ?? res.results ?? res)[0];
      if (!user) throw new Error('Pemain tidak ditemukan');
      const prop = await this.g.userProperty(user.id);
      const cats = (prop.cats ?? []).filter((c) => c.isTradable).slice(0, 8);
      const ui = this;
      return async function pickTheirCat() {
        return {
          text: `🤝 Pilih kucing milik <b>${esc(user.username)}</b> yang mau kamu minta:`,
          kb: ui.nav(...cats.map((c) => [ui.btn(`${RARITY_ICON[c.rarity]} ${c.name} ${c.profession} L${c.level}`, ui.ask(`Berapa PAWS yang kamu tawarkan untuk ${esc(c.name)}?`, async (amt) => {
            if (!(Number(amt) > 0)) throw new Error('Jumlah tidak valid');
            return ui.confirm(`Tawarkan ${esc(amt)} PAWS ke ${esc(user.username)} untuk ${esc(c.name)}?`, 'Tawaran dikirim', () => ui.g.createTrade(user.id, { catIds: [], catAmount: amt.trim() }, { catIds: [c.id], catAmount: '0' }), ui.tradesScreen)();
          }))]), [ui.btn('⬅️ Trade', () => ui.tradesScreen)]),
        };
      };
    }))]);
    return { text: `${this.takeFlash()}🤝 <b>Trade P2P</b>\n${lines.join('\n') || 'Belum ada trade.'}`, kb: this.nav(...rows, [this.btn('⬅️ Wallet', () => this.walletScreen)]) };
  }

  // ----- permits & recruit
  async permitScreen() {
    this.panelScreen = this.permitScreen;
    const [pm, rc, floor] = await Promise.all([this.g.permits(), this.g.recruitments(), this.g.marketFloor().catch(() => null)]);
    // Expected market value of one recruit: official odds x current floor per rarity.
    const odds = Object.entries(rc.oddsWithLuck ?? rc.odds ?? {});
    const ev = floor ? odds.reduce((a, [r, bps]) => a + (bps / 10000) * n(floor.byRarity?.[r]), 0) : 0;
    const evNoMythic = floor ? odds.filter(([r]) => r !== 'MYTHIC').reduce((a, [r, bps]) => a + (bps / 10000) * n(floor.byRarity?.[r]), 0) : 0;
    const oddsLine = odds.map(([r, bps]) => `${RARITY_ICON[r] ?? ''}${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`).join(' ');
    const now = this.g.c.now();
    const act = (pm.active ?? []).map((p) => `• permit ${esc(p.status)} ${p.completesAt ? until(p.completesAt, now) : ''}`).join('\n');
    const ract = (rc.active ?? []).map((r) => `• rekrut ${esc(r.status)} ${until(r.readyAt, now)}`).join('\n');
    const frag = pm.wallet.fragments.map((f) => `${f.selected ? '🎯' : '·'} ${esc(f.name)} ${f.balance}/${f.threshold}`).join('  ');
    const rows = [];
    rows.push([this.btn(`📜 Beli permit (${num(pm.cost.cat)} PAWS)${pm.canStart ? '' : ' ⛔'}`, this.confirm(`Ajukan Business Permit (1 jam) seharga ${num(pm.cost.cat)} $PAWS + ${esc(JSON.stringify(pm.cost.resources))}?\nPeluang: ${esc(pm.table.filter((t) => !t.locked).map((t) => `${t.name} ${(t.weightWithLuckBps / 100).toFixed(1)}%`).join(', '))}`, 'Permit diajukan', () => this.g.buyPermit(false, pm.cost.cat), this.permitScreen))]);
    if (pm.wallet.permitTickets > 0) rows.push([this.btn(`🎟 Permit pakai ticket (${pm.wallet.permitTickets})`, this.doThen('Permit (ticket)', () => this.g.buyPermit(true, '0'), this.permitScreen))]);
    rows.push(pm.wallet.fragments.filter((f) => f.enabled).map((f) => this.btn(`🎯 ${f.name}`, this.doThen(`Target fragment ${f.name}`, () => this.g.permitTarget(f.type), this.permitScreen))));
    const tgt = pm.wallet.fragments.find((f) => f.selected);
    if (tgt && tgt.balance >= tgt.threshold) rows.push([this.btn(`🔨 Craft ${tgt.name}`, this.confirm(`Craft ${esc(tgt.name)} seharga ${num(tgt.craft.catCost)} PAWS?`, 'Craft dimulai', () => this.g.craft({ target: tgt.type, maxCatCost: tgt.craft.catCost }), this.permitScreen))]);
    rows.push([this.btn(`🍺 Rekrut kucing (${num(rc.costs.cat)} PAWS)${rc.canStart ? '' : ' ⛔'}`, this.confirm(`Rekrut kucing baru seharga ${num(rc.costs.cat)} $PAWS + ${esc(JSON.stringify(rc.costs.resources))} (${dur(rc.durationSeconds)})?`, 'Rekrut dimulai', () => this.g.recruit(false, rc.costs.cat), this.permitScreen))]);
    if (rc.canStartWithTicket) rows.push([this.btn(`🎟 Rekrut pakai ticket (${rc.tickets})`, this.doThen('Rekrut (ticket)', () => this.g.recruit(true, '0'), this.permitScreen))]);
    rows.push([this.btn('✅ Claim semua yang siap', async () => { await this.e.claimPermits(); await this.e.recruiting(false, false); await this.e.deployStored(); this.flash = '✅ Dicek & diklaim'; return this.permitScreen; })]);
    return {
      text: `${this.takeFlash()}📜 <b>Permit Office</b> · ${pm.plot.name} (maks ${pm.plot.maxRarity})
Stasiun ${pm.stations.deployed}/${pm.stations.slots} · ticket permit ${pm.wallet.permitTickets} · ticket kucing ${pm.wallet.catTickets}
${pm.canStart ? '✅ bisa ajukan' : `⛔ ${esc(blockers(pm.blockers))}`}
Fragment: ${frag}
${act}

🍺 <b>Tavern</b> · kucing ke-${rc.ladder.sequence} · ${dur(rc.durationSeconds)}
Peluang: ${oddsLine}
💹 Nilai rata-rata 1 rekrut di market ≈ <b>${num(ev, 0)} PAWS</b> (tanpa Mythic ${num(evNoMythic, 0)}) vs biaya ${num(rc.costs.cat, 0)}. Kucing hasil rekrut pakai PAWS bisa dijual setelah ${this.e.cfg.recruitment.tradeCooldownHours} jam; hasil rekrut gratis/ticket tidak bisa dijual.
${rc.canStart ? '✅ bisa rekrut' : `⛔ ${esc(blockers(rc.blockers))}`} · pity ${rc.pity.count}/${rc.pity.everyN} (${rc.pity.minRarity}+)
${ract}`,
      kb: this.nav(...rows),
    };
  }

  // ----- tutorial
  async tutorialScreen() {
    this.panelScreen = this.tutorialScreen;
    const t = this.state().tutorial ?? (await this.g.tutorial().catch(() => null));
    if (!t || !t.active) return { text: `${this.takeFlash()}🎓 Tutorial sudah selesai ✅`, kb: this.nav() };
    const lines = t.objectives.map((o) => `${o.done ? '✅' : o.current ? '👉' : '▫️'} ${esc(o.label)}`).join('\n');
    return {
      text: `${this.takeFlash()}🎓 <b>Tutorial</b> (${t.objectivesDone}/${t.objectives.length})\nLangkah sekarang: <b>${esc(t.current)}</b>\nAuto tutorial: ${this.s.get('autoTutorial') ? 'ON' : 'OFF'}\n\n${lines}`,
      kb: this.nav(
        [this.btn(`Auto tutorial: ${this.s.get('autoTutorial') ? 'ON' : 'OFF'}`, () => { this.s.toggle('autoTutorial'); return this.tutorialScreen; }), this.btn('▶️ Proses sekarang', async () => { await this.e.runNow(); return this.tutorialScreen; })],
        [this.btn('⏭ Skip tutorial', this.confirm('Skip tutorial? Hadiah tutorial yang tersisa bisa hilang dan reward butuh tutorial selesai.', 'Tutorial di-skip', () => this.g.tutorialSkip(), this.tutorialScreen))],
      ),
    };
  }

  // ----- leaderboard
  async leaderScreen() {
    this.panelScreen = this.leaderScreen;
    const lb = await this.g.leaderboards();
    const lines = lb.boards.map((b) => `<b>${esc(b.label)}</b>\n${b.top.slice(0, 3).map((t) => `  ${t.rank}. ${esc(t.username)} – ${esc(t.value)}`).join('\n')}${b.me ? `\n  👉 kamu #${b.me.rank} (${esc(b.me.value)})` : ''}`).join('\n');
    return { text: `🏆 <b>Leaderboard</b>\n${lines}`, kb: this.nav() };
  }

  // ----- settings
  async settingsScreen() {
    this.panelScreen = this.settingsScreen;
    const s = this.s;
    const tg = (k, label) => this.btn(`${s.get(k) ? '✅' : '⬜'} ${label}`, () => { s.toggle(k); return this.settingsScreen; });
    const cycle = (k, list, label) => this.btn(`${label}: ${s.get(k)}`, () => { const i = list.indexOf(String(s.get(k))); s.set(k, list[(i + 1) % list.length]); return this.settingsScreen; });
    return {
      text: `${this.takeFlash()}⚙️ <b>Setting bot</b>
Shift: <b>${s.get('shiftMode')}</b> ${s.get('shiftMode') === 'auto' ? `(terpanjang yang stamina cukup, ${s.get('minShift')}-${s.get('maxShift')} menit)` : 'menit'}
Prioritas: <b>${s.get('prefer') === 'points' ? 'poin reward' : 'resource'}</b>
Maks belanja otomatis per aksi: <b>${num(s.get('maxSpendPerAction'))} PAWS</b> · cadangan tidak dipakai: <b>${num(s.get('keepPaws'))} PAWS</b>
Auto Grow: isi slot kucing kosong (beli di market) → perluas lahan → upgrade stasiun poin (+15% output/level) → House jika syarat lahan
Repair kalau kondisi &lt; ${s.get('repairBelow')}% · tick ${s.get('tickSeconds')} detik
Notifikasi: ${s.get('notify')}`,
      kb: this.nav(
        [tg('running', 'Auto ON'), tg('autoTutorial', 'Tutorial')],
        [tg('autoFarm', 'Farming'), tg('autoRest', 'Rest gratis')],
        [tg('autoNap', 'Nap (PAWS)'), tg('autoLevelUp', 'Level up')],
        [tg('levelUpSpendPaws', 'Level up pakai PAWS'), tg('autoRepair', 'Repair')],
        [tg('repairSpendPaws', 'Repair pakai PAWS'), tg('autoClaimRewards', 'Claim reward')],
        [tg('autoPermits', 'Permit & stasiun'), tg('autoRecruit', 'Rekrut gratis')],
        [tg('autoUpgradeBuildings', 'Auto Grow (PAWS)'), tg('dropOverflow', 'Claim walau gudang penuh')],
        [tg('autoCollectOnchain', 'Collect reward on-chain'), tg('fastActivity', 'Shift 10m s/d eligible')],
        [tg('autoBuyCats', 'Beli kucing market (slot kosong)')],
        [cycle('shiftMode', SHIFT_MODES, '⏱ Shift'), cycle('maxShift', ['60', '120', '240', '480'], 'Maks')],
        [cycle('prefer', ['points', 'resources'], '🎯 Prioritas'), cycle('notify', NOTIFY_MODES, '🔔')],
        [this.btn('💸 Ubah maks belanja', this.ask('Maksimal $PAWS per aksi otomatis (contoh 500):', async (t) => { s.set('maxSpendPerAction', Math.max(0, Number(t) || 0)); return this.settingsScreen; })),
          this.btn('🏦 Cadangan PAWS', this.ask('Jumlah PAWS yang selalu disisakan (tidak dipakai otomatis), contoh 500:', async (t) => { s.set('keepPaws', Math.max(0, Number(t) || 0)); return this.settingsScreen; }))],
        [this.btn('🛠 Batas repair', this.ask('Repair otomatis kalau kondisi di bawah berapa % (contoh 50):', async (t) => { s.set('repairBelow', Math.min(100, Math.max(1, Number(t) || 50))); return this.settingsScreen; }))],
      ),
    };
  }

  async helpScreen() {
    this.panelScreen = this.helpScreen;
    return {
      text: `❓ <b>Panduan tombol</b>

<b>Perintah</b>: /menu dashboard · /cats kucing · /market market · /wallet wallet · /rewards reward · /referral referral · /log log · /pause stop otomatis · /resume jalan lagi · /help panduan

<b>Dashboard</b>
🔄 Refresh data · ⏸/▶️ matikan/nyalakan auto · ⚡ Jalankan 1 siklus sekarang

🐱 <b>Kucing</b>: pilih kucing → ⛏ kerja (pilih stasiun &amp; durasi, 🎁 = dapat poin) · 😴 rest gratis · 💤 nap berbayar · 📈 level up (pilih peluang) · ⭐ main cat · 🛡 protect · ✏️ rename · 💲 jual · 🗑 release
🏗 <b>Bangunan</b>: ⬆️ upgrade · 🛠 repair · 🚑 emergency repair gratis · 🔄 putar · 📦 simpan · 📍 pasang · 🏡 perluas lahan
⏱ <b>Shift</b>: ✅ claim · ❌ batal · ⚡ fast track
🎁 <b>Reward</b>: checklist eligible, poin per pool saham &amp; $PAWS, 💰 claim &amp; collect on-chain
🛒 <b>Market</b>: floor harga, 🔍 termurah/🆕 terbaru/💪 stat, filter rarity, 🛍 beli, 💲 jual, 🏷 batal listing, 📈 penjualan terakhir
👛 <b>Wallet</b>: saldo game &amp; on-chain, harga PAWS, 🛒 beli PAWS (ETH/USDG, langsung masuk game), ⬇️ deposit, ⬆️ withdraw, explorer
📜 <b>Permit &amp; Rekrut</b>: beli permit, pakai ticket, 🎯 target fragment, 🔨 craft, 🍺 rekrut kucing, ✅ claim semua
🎓 <b>Tutorial</b>: progres, auto on/off, skip
🏆 <b>Leaderboard</b>: top pemain &amp; posisimu
👑 <b>Membership</b>: pass 50 USDG/30 hari → pool khusus member
🤝 <b>Referral</b>: kode &amp; link, 📤 bagikan, statistik teman, ✏️ ganti kode
🔒 <b>Stake</b>: kunci PAWS untuk diskon waktu bangun/rekrut
✍️ <b>Creator</b>: daftar, hubungkan X, kirim link post → hadiah SPCX
🤝 <b>Trade P2P</b>: tawar PAWS untuk kucing pemain lain, setujui/batal
⚙️ <b>Setting</b>: semua fitur otomatis on/off, mode shift, prioritas, batas belanja, notifikasi
📋 <b>Log</b> aktivitas · 💡 <b>Strategi Cuan</b>

Semua aksi yang memakai PAWS/USDG/ETH selalu minta konfirmasi ✅ dulu.`,
      kb: this.nav(),
    };
  }

  async logScreen() {
    this.panelScreen = this.logScreen;
    const st = this.e.stats;
    const lines = this.e.logs.slice(-22).map(esc).join('\n');
    const head = `${this.s.get('running') ? '🟢 jalan' : '🔴 pause'} · siklus terakhir ${ago(st.lastTick)} · berikutnya ${st.nextTick ? until(new Date(st.nextTick).toISOString()) : '-'}\n${esc(this.e.statusLine())}`;
    return { text: `📋 <b>Log</b>\n${head}\n<pre>${lines || 'Belum ada kejadian (kucing sedang shift, tidak ada yang perlu di-claim).'}</pre>`.slice(0, 4000), kb: this.nav() };
  }

  async strategyScreen() {
    this.panelScreen = this.strategyScreen;
    const cfg = this.e.cfg;
    const ds = cfg.jobs.durations;
    const rows = ds.filter((d) => d.minutes >= 10).map((d) => `${String(d.minutes).padStart(3)}m  eff ${(d.efficiencyBps / 100).toFixed(0)}%  -${String(d.staminaCost).padStart(2)}⚡  ${(d.staminaCost / (d.minutes / 60)).toFixed(1)}⚡/jam`).join('\n');
    const regen = cfg.stamina.regenPerHour;
    const el = cfg.rewards.eligibility;
    const pools = cfg.rewards.pools.map((p) => `${p.symbol} ${(p.fundingWeightBps / 100).toFixed(0)}%`).join(' · ');
    return {
      text: `💡 <b>Strategi cuan Paws of Sherwood</b>

<b>1. Shift panjang = paling efisien</b>
<pre>${rows}</pre>Regen stamina dasar ${regen}⚡/jam (+endurance). Shift 8 jam cuma makan 10⚡/jam tapi efisiensinya 118%. Jadi bot otomatis pilih shift terpanjang yang stamina-nya cukup. Kalau stamina habis, bot pakai rest gratis.

<b>2. Wajib eligible dulu biar dapat reward</b>
Tutorial selesai (bot otomatis), kucing L${el.minCatLevel}+, ${el.minClaimedJobs} shift <b>penghasil poin</b> diklaim (≥10 menit di stasiun 🎁), dan <b>$PAWS milikmu dibelanjakan/di-stake minimal ${el.minSpendOrDeposit}</b>.
Cara termurah: Wallet → Beli PAWS ±1 USDG (≈700-1000 PAWS, otomatis masuk game), lalu level up kucing L3→L4 (150 PAWS) = syarat belanja terpenuhi sekaligus kucing makin kuat.

<b>3. Poin → 2 jenis hadiah tiap ronde 12 jam</b>
• Saham ter-tokenisasi per kategori (${pools}). Hadiah dibagi proporsional sesuai poinmu dibanding total poin pemain.
• Pool $PAWS (catPool) juga dibagi berdasarkan poin.
Kerjakan stasiun bertanda 🎁 (Lumber Camp→AAPL, Coffee Farm→COST, Power→TSLA, Mine→MSFT, Trading Post→AMZN, Exchange→GOOGL, GPU Farm→NVDA). Pool yang kontributornya sedikit (cek menu Reward: share%) = bagian lebih besar.

<b>4. Scale up</b>
• Rekrut kucing (gratis sekali, berikutnya 1500 PAWS). Tiap 10 rekrut dijamin RARE+.
• Perluas lahan → slot stasiun &amp; kucing aktif lebih banyak.
• Profesi cocok = +25% produksi. Trait Hard Worker / Prospector / Golden Paw berharga.
• Level up kucing: L1-3 gratis, setelah itu bayar PAWS (gagal = PAWS hangus, level aman).

<b>5. Trading kucing</b>
Beli di bawah floor (menu Market → Termurah), jual di atas floor. Fee market 5%. Kucing RARE+ dengan trait bagus dijual jauh di atas floor.

<b>6. Referral</b>
Kode kamu ada di menu Wallet: dapat 10% dari belanja teman + ticket.

<b>7. Token selain PAWS</b>
• Saham ter-tokenisasi AAPL, COST, TSLA, MSFT, AMZN, GOOGL, NVDA (reward ronde, di-collect on-chain ke wallet).
• SPCX (SpaceX) dari Creator program: post di X tentang game → submit link.
• USDG = mata uang beli PAWS &amp; membership.
Kucing <b>bukan NFT</b>: kucing hanya ada di server game (jual-beli lewat Marketplace/Trade, bayar PAWS).

<b>8. Membership (pass bulanan)</b>
50 USDG/30 hari → ikut pool khusus member. Ronde lalu median member dapat ±5.000 PAWS + ±$5,7 saham per ronde 12 jam (cek angka terbaru di menu Membership).

<b>9. Cara dapat kucing</b>
• Gratis: starter cat + 1 kredit rekrut pertama (dipakai otomatis saat tutorial), dan Cat Pack ticket dari event (tidak bisa dijual).
• Rekrut di Tavern (1500 PAWS, acak; nilai rata-rata di market sering &gt; biaya, lihat menu Permit &amp; Rekrut), pity RARE+ tiap 10 rekrut.
• Beli di Market (paling murah untuk mengisi slot kerja) atau Trade P2P.
Tidak ada shop/chest/bundle berbayar; satu-satunya pass berbayar adalah Membership.
Lebih banyak kucing hanya berguna sampai batas kucing kerja di lahanmu (3/5/8/12/20 per tier) dan slot stasiun. Setelah penuh, perluas lahan.

<b>10. Belanja yang dihitung untuk syarat reward</b>
Kata game: "150 $PAWS of your own spent or staked: a deposit does not count". Yang dihitung: PAWS yang dihabiskan di game (level up, upgrade, rekrut, permit, repair, nap, fast track, perluas lahan) atau di-stake. Deposit dan beli kucing di Market tidak dihitung. Termurah + berguna: level up kucing L3→L4 (150 PAWS).

<b>11. Cara dapat PAWS</b>
Beli di pool (Wallet → Beli), jual kucing di Market, reward pool $PAWS tiap ronde, referral, dan membership pool.`,
      kb: this.nav([this.btn('🎁 Lihat pool reward', () => this.rewardsScreen), this.btn('🛒 Market', () => this.marketScreen)]),
    };
  }
}
