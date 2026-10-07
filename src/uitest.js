// Renders every Telegram screen against live data without sending anything, to catch errors.
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
const settings = new Settings(dataDir);
const engine = new Engine({ game: new Game(client), settings, log: () => {} });
await engine.refresh();
engine.cfg ??= (await engine.g.config()).config;
const ui = new TelegramUI({ token: 'x', chatId: '1', engine, settings });

const cat = engine.state.cats[0];
const b = engine.state.property.buildings.find((x) => x.hostsJobs);
const screens = {
  home: ui.home, cats: ui.catsScreen, cat: ui.catScreen(cat.id), pickBuilding: ui.pickBuilding(cat.id),
  pickMinutes: ui.pickMinutes(cat.id, b.id), sell: ui.sellScreen(cat.id), buildings: ui.buildingsScreen,
  building: ui.buildingScreen(b.id), house: ui.buildingScreen(engine.state.property.house.buildingId),
  jobs: ui.jobsScreen, rewards: ui.rewardsScreen, market: ui.marketScreen, browse: ui.browse({ sort: 'price_asc' }),
  recent: ui.recentSales, wallet: ui.walletScreen, permits: ui.permitScreen, tutorial: ui.tutorialScreen,
  leader: ui.leaderScreen, settings: ui.settingsScreen, log: ui.logScreen, strategy: ui.strategyScreen,
  buyEth: ui.buyScreen('eth'), buyUsdg: ui.buyScreen('usdg'), stake: ui.stakeScreen, membership: ui.membershipScreen,
  creator: ui.creatorScreen, trades: ui.tradesScreen,
};
engine.chain = new Chain(client, engine.g);
let bad = 0;
for (const [name, fn] of Object.entries(screens)) {
  try {
    const r = await fn.call(ui);
    const len = r.text.length;
    if (len > 4096) throw new Error(`text too long (${len})`);
    const btns = (r.kb ?? []).flat().length;
    console.log(`OK   ${name.padEnd(12)} ${len} chars, ${btns} buttons`);
    if (name === 'home' || name === 'strategy') console.log(r.text.replace(/<[^>]+>/g, '') + '\n');
  } catch (e) {
    bad++;
    console.log(`FAIL ${name}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
  }
}
process.exit(bad ? 1 : 0);
