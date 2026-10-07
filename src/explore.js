// Logs in and dumps every read-only endpoint to data/explore/*.json so the bot logic
// can be checked against the account's real data. Never prints the private key.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PawsClient } from './api.js';

const dataDir = path.resolve('data');
const out = path.join(dataDir, 'explore');
fs.mkdirSync(out, { recursive: true });

const c = new PawsClient({ privateKey: process.env.PRIVATE_KEY, dataDir });
console.log('Wallet:', c.address);
try {
  await c.ensureSession();
} catch (e) {
  console.error('Login failed:', e.code, e.status, e.message, JSON.stringify(e.details ?? {}));
  process.exit(1);
}

const endpoints = [
  '/me', '/home', '/property', '/cats', '/jobs?status=ACTIVE', '/jobs?status=DONE', '/jobs?status=COMPLETED',
  '/permits', '/recruit', '/recruitments', '/rewards', '/rewards/earned', '/stakes', '/wallet',
  '/wallet/activity', '/upgrades', '/tutorial', '/notifications', '/membership', '/market', '/marketplace/floor',
  '/marketplace/mine', '/referrals/me', '/leaderboards', '/config/public',
];
for (const ep of endpoints) {
  const file = path.join(out, ep.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') + '.json');
  try {
    const r = await c.get(ep);
    fs.writeFileSync(file, JSON.stringify(r, null, 2));
    console.log('OK  ', ep);
  } catch (e) {
    fs.writeFileSync(file, JSON.stringify({ error: e.code, status: e.status, message: e.message, details: e.details }, null, 2));
    console.log('FAIL', ep, e.status, e.code, e.message);
  }
}
