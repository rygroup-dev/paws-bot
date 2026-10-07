// Entry point: sign in (solving the one-time human check if needed), then run the
// automation loop and the Telegram control panel.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PawsClient, ApiError } from './api.js';
import { Game } from './game.js';
import { Settings } from './settings.js';
import { Engine } from './engine.js';
import { TelegramUI } from './telegram.js';
import { loginWithHumanCheck } from './human.js';
import { Chain } from './chain.js';

const dataDir = path.resolve('data');
if (!process.env.PRIVATE_KEY) {
  console.error('PRIVATE_KEY kosong di .env');
  process.exit(1);
}

// One bot per data folder: two copies would double every action and fight over Telegram updates.
const lockFile = path.join(dataDir, 'bot.lock');
fs.mkdirSync(dataDir, { recursive: true });
try {
  const pid = Number(fs.readFileSync(lockFile, 'utf8'));
  if (pid && pid !== process.pid) {
    process.kill(pid, 0); // throws if that process is gone
    console.error(`Bot sudah jalan (pid ${pid}). Tutup dulu yang lama, atau hapus data/bot.lock kalau yakin tidak jalan.`);
    process.exit(1);
  }
} catch {}
fs.writeFileSync(lockFile, String(process.pid));
const releaseLock = () => { try { if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.unlinkSync(lockFile); } catch {} };
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

const client = new PawsClient({ privateKey: process.env.PRIVATE_KEY, dataDir });
console.log(`Paws bot · wallet ${client.address}`);

try {
  await client.me();
} catch (e) {
  if (!(e instanceof ApiError) || ![401, 403].includes(e.status)) throw e;
  await loginWithHumanCheck(client);
}

const settings = new Settings(dataDir);
let tg = null;
// Activity log on disk (data/bot.log, rotated at 2 MB) so the bot's history can be reviewed.
const logPath = path.join(dataDir, 'bot.log');
const writeLog = (line) => {
  console.log(line);
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2_000_000) fs.renameSync(logPath, `${logPath}.1`);
    fs.appendFileSync(logPath, `${new Date().toISOString().slice(0, 10)} ${line}\n`);
  } catch {}
};
const engine = new Engine({
  game: new Game(client),
  settings,
  notify: (msg) => tg?.notify(msg),
  log: writeLog,
});

engine.chain = new Chain(client, engine.g);
writeLog(`${new Date().toLocaleTimeString('id-ID', { hour12: false })} 🚀 Bot mulai jalan (pid ${process.pid})`);

if (process.env.TELEGRAM_BOT_TOKEN) {
  tg = new TelegramUI({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, engine, settings });
  tg.start();
  await engine.refresh().catch(() => {});
  if (tg.chatId) await tg.show(tg.home).catch((e) => console.error('Telegram:', e.message));
  console.log('Telegram aktif. Kirim /menu ke bot untuk dashboard.');
} else {
  console.log('TELEGRAM_BOT_TOKEN kosong: jalan tanpa Telegram.');
}

engine.start();
process.on('unhandledRejection', (e) => console.error('Unhandled:', e?.message ?? e));
