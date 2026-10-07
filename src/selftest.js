// Runs a few engine ticks without Telegram and prints the log (for checking the automation).
import 'dotenv/config';
import path from 'node:path';
import { PawsClient } from './api.js';
import { Game } from './game.js';
import { Settings } from './settings.js';
import { Engine } from './engine.js';

const dataDir = path.resolve('data');
const client = new PawsClient({ privateKey: process.env.PRIVATE_KEY, dataDir });
const engine = new Engine({ game: new Game(client), settings: new Settings(dataDir) });
const ticks = Number(process.argv[2] ?? 6);
for (let i = 0; i < ticks; i++) {
  const wait = await engine.tick();
  const t = engine.state.tutorial;
  console.log(`-- tick ${i + 1}: tutorial=${t?.current ?? 'done'} cats=${engine.state.cats?.map((c) => `${c.name}:${c.activity}:L${c.level}:${Math.round(c.stamina)}st`).join(',')} wait=${Math.round(wait / 1000)}s`);
  await new Promise((r) => setTimeout(r, Math.min(wait, 15000)));
}
