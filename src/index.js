// Entry point: sign in (solving the one-time human check if needed), then run the
// automation loop and the Telegram control panel.
import 'dotenv/config';
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
const engine = new Engine({
  game: new Game(client),
  settings,
  notify: (msg) => tg?.notify(msg),
});

engine.chain = new Chain(client, engine.g);

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
