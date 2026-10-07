// Presses every Telegram button (breadth-first, a few levels deep) against live read data.
// All writes are stubbed: POSTs to the game, on-chain transactions and Telegram sends are
// recorded instead of executed. Reports crashes, HTML Telegram would reject, and limits.
import 'dotenv/config';
import path from 'node:path';
import { PawsClient } from './api.js';
import { Game } from './game.js';
import { Settings } from './settings.js';
import { Engine } from './engine.js';
import { TelegramUI } from './telegram.js';
import { Chain } from './chain.js';

const dataDir = path.resolve('data');
const client = new PawsClient({ privateKey: process.env.PRIVATE_KEY, dataDir });
const writes = [];
const realRaw = client.raw.bind(client);
client.raw = (p, opts = {}) => {
  if ((opts.method ?? 'GET') === 'GET') return realRaw(p, opts);
  writes.push(`POST ${p}`);
  return Promise.resolve({ stub: true, status: 'OK', claimId: null, collect: null, authorizeUrl: 'https://example.com/x', membership: { member: true } });
};
const settings = new Settings(path.resolve('data', 'clicktest'));   // throwaway settings copy
const engine = new Engine({ game: new Game(client), settings, log: () => {} });
engine.chain = new Chain(client, engine.g);
for (const m of ['deposit', 'buyAndDeposit', 'buyMembership', 'collectReward', 'withdraw']) {
  engine.chain[m] = async (...a) => { writes.push(`CHAIN ${m}(${a.filter((x) => typeof x !== 'function').map(String).join(',')})`); return { stub: true, txHash: '0x' + '0'.repeat(64), swapHash: '0x' + '0'.repeat(64), received: '1', credited: true }; };
}
engine.runNow = async () => { writes.push('ENGINE runNow'); };
await engine.refresh();
engine.cfg ??= (await engine.g.config()).config;
engine.state.rewards = await engine.g.rewards();

const ui = new TelegramUI({ token: 'x', chatId: '1', engine, settings });
const sent = [];
let lastPrompt = '';
ui.call = async (method, body) => { sent.push(method); if (method === 'sendMessage') { lastPrompt = body.text; checkHtml(body.text, `sendMessage`); } return { message_id: 1 }; };

const problems = [];
const ALLOWED = new Set(['b', 'i', 'code', 'pre', 'a', 'u', 's']);
function checkHtml(text, where) {
  if (text.length > 4096) problems.push(`${where}: text ${text.length} > 4096`);
  const stack = [];
  for (const m of text.matchAll(/<(\/?)([a-z]+)[^>]*>/gi)) {
    const [, close, tag] = m;
    if (!ALLOWED.has(tag.toLowerCase())) { problems.push(`${where}: tag <${tag}> not allowed`); continue; }
    if (close) { if (stack.pop() !== tag) problems.push(`${where}: unbalanced </${tag}>`); } else stack.push(tag);
  }
  if (stack.length) problems.push(`${where}: unclosed <${stack.join(',')}>`);
  const stripped = text.replace(/<\/?[a-z]+[^>]*>/gi, '');
  if (/[<>]/.test(stripped)) problems.push(`${where}: raw < or > in text: ${stripped.match(/.{0,20}[<>].{0,20}/)[0]}`);
  const amp = stripped.match(/&(?!(amp|lt|gt|quot|#\d+);)/);
  if (amp) problems.push(`${where}: raw & in text near "${stripped.slice(Math.max(0, amp.index - 15), amp.index + 15)}"`);
}

const SAMPLE = (prompt) => (/url post|URL/i.test(prompt) ? 'https://x.com/someone/status/1' : /username pemain/i.test(prompt) ? 'someplayer' : /kode referral/i.test(prompt) ? 'TESTCODE' : /nama baru/i.test(prompt) ? 'Robin' : /all/.test(prompt) ? '1' : '1000');

let clicks = 0;
const seen = new Set();
const queue = [{ screen: ui.home, trail: 'home', depth: 0 }];
const MAX_DEPTH = Number(process.argv[2] ?? 4);
while (queue.length && clicks < 1500) {
  const { screen, trail, depth } = queue.shift();
  let r;
  try { r = await screen.call(ui); } catch (e) { problems.push(`${trail}: render crash ${e.message}`); continue; }
  if (!r?.text) { problems.push(`${trail}: empty screen`); continue; }
  checkHtml(r.text, trail);
  const sig = r.text.replace(/\d+/g, '#') + '|' + (r.kb ?? []).flat().map((b) => b.text.replace(/\d+/g, '#')).join(',');
  if (seen.has(sig)) continue;
  seen.add(sig);
  for (const b of (r.kb ?? []).flat()) {
    if (!b.text) problems.push(`${trail}: button without text`);
    if (b.url) { if (!/^https?:\/\//.test(b.url)) problems.push(`${trail}: bad url ${b.url}`); continue; }
    if (b.callback_data.length > 64) problems.push(`${trail}: callback_data > 64`);
    if (depth >= MAX_DEPTH || /Dashboard|Refresh/.test(b.text)) continue;
    const fn = ui.actions.get(b.callback_data.slice(2));
    clicks++;
    const label = `${trail} > ${b.text}`;
    try {
      let next = await fn();
      if (ui.awaiting) {   // the button asked for text input: answer it like a user would
        const a = ui.awaiting; ui.awaiting = null;
        try { next = await a.handler(SAMPLE(lastPrompt)); } catch (e) { if (!/tidak valid|Minimal|harus|tidak ditemukan|tidak cukup|kurang/i.test(e.message)) problems.push(`${label} [input]: ${e.message}`); next = null; }
      }
      if (typeof next === 'function') queue.push({ screen: next, trail: label, depth: depth + 1 });
    } catch (e) {
      const expected = /tidak valid|Minimal|Maksimal|tidak bisa|tidak tersedia|Saldo|Pool tidak/i.test(e.message);
      if (!expected) problems.push(`${label}: ${e.constructor.name} ${e.message}`);
    }
  }
}

console.log(`Screens: ${seen.size} · clicks: ${clicks} · stubbed writes: ${writes.length}`);
console.log([...new Set(writes)].slice(0, 80).join('\n'));
console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n${[...new Set(problems)].join('\n')}` : '\nNO PROBLEMS');
process.exit(problems.length ? 1 : 0);
