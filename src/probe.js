// Read-only probe: GETs every endpoint the bot reads and prints the top-level shape, so the
// bot's field names can be checked against what the server really returns.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PawsClient } from './api.js';

const dataDir = path.resolve('data');
const out = path.join(dataDir, 'probe');
fs.mkdirSync(out, { recursive: true });
const c = new PawsClient({ privateKey: process.env.PRIVATE_KEY, dataDir });
await c.me();
const prop = await c.get('/property');
const cat = prop.cats[0];
const b = prop.buildings.find((x) => x.hostsJobs);
const eps = process.argv.slice(2).length ? process.argv.slice(2) : [
  '/me', '/property', '/cats', `/cats/${cat.id}`, '/jobs?status=ACTIVE', '/tutorial', '/rewards', '/rewards/earned',
  '/permits', '/recruitments', '/upgrades', `/cats/${cat.id}/upgrade-quote?targetChancePct=0`,
  `/buildings/${b.id}/worker-ranking?minutes=10`, '/wallet', '/wallet/activity', '/stakes', '/notifications',
  '/leaderboards', '/referrals/me', '/membership', '/buy', '/marketplace/floor', '/marketplace/mine',
  '/marketplace/recent-sales', '/marketplace?sort=price_asc&limit=2', '/trades', '/hub/online', '/creator',
];
const shape = (v, d = 0) => {
  if (Array.isArray(v)) return v.length ? `[${shape(v[0], d)}]` : '[]';
  if (v && typeof v === 'object') return d > 1 ? '{…}' : `{${Object.entries(v).map(([k, x]) => `${k}:${shape(x, d + 1)}`).join(', ')}}`;
  return typeof v === 'string' && v.length > 24 ? 'str' : JSON.stringify(v);
};
for (const ep of eps) {
  try {
    const r = await c.get(ep);
    fs.writeFileSync(path.join(out, ep.replace(/[^a-z0-9]+/gi, '_') + '.json'), JSON.stringify(r, null, 2));
    console.log(`OK   ${ep}\n     ${shape(r).slice(0, 900)}`);
  } catch (e) {
    console.log(`FAIL ${ep} ${e.status} ${e.code} ${e.message}`);
  }
}
