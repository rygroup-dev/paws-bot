// Paws of Sherwood REST client (mirrors what the web app does in /assets/ws-*.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.PAWS_BASE || 'https://pawsofsherwood.com';
// Referral code applied when a new account is created (overridable with REFERRAL_CODE in .env).
export const REFERRAL_CODE = (process.env.REFERRAL_CODE || 'TGPEMVTV').toUpperCase();
const API = `${BASE}/api`;
// The web build hash; the server answers 409/UPDATING when it changes. Refreshed from /health.
let CLIENT_BUILD = 'c8530d9e8ac0423d1dbff4f48ad5e3e2f150ef7e';

export class ApiError extends Error {
  constructor(code, status, message, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PawsClient {
  constructor({ privateKey, dataDir, log = console.log }) {
    this.account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
    this.address = this.account.address;
    this.dataDir = dataDir;
    this.log = log;
    this.sessionFile = path.join(dataDir, `session-${this.address.toLowerCase()}.json`);
    this.cookies = {};
    this.csrf = null;
    this.deviceId = crypto.randomBytes(16).toString('hex');
    this.serverOffsetMs = 0;
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      this.cookies = s.cookies || {};
      this.deviceId = s.deviceId || this.deviceId;
      this.csrf = s.csrf || null;
    } catch {}
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.sessionFile, JSON.stringify({ cookies: this.cookies, deviceId: this.deviceId, csrf: this.csrf }, null, 2));
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    let changed = false;
    for (const c of list) {
      const [pair, ...attrs] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired || value === '') delete this.cookies[name];
      else this.cookies[name] = value;
      changed = true;
    }
    if (changed) this.save();
  }

  now() {
    return Date.now() + this.serverOffsetMs;
  }

  async raw(pathname, { method = 'GET', body, idempotent = false, retries = 3 } = {}) {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
      Origin: BASE,
      Referer: `${BASE}/`,
      'x-device-id': this.deviceId,
      'x-client-build': CLIENT_BUILD,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf;
    if (idempotent) headers['idempotency-key'] = crypto.randomUUID();
    const ck = this.cookieHeader();
    if (ck) headers.Cookie = ck;

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(`${API}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) {
        if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
        throw new ApiError('NETWORK', 0, `Could not reach server: ${e.cause?.code || e.message}`);
      }
      this.storeCookies(res);
      if (res.status === 204) return null;
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.ok) return data;
      const code = data?.error?.code || 'HTTP_ERROR';
      const updating = code === 'UPDATING' || res.status >= 500;
      if (updating && attempt < retries) {
        await this.refreshBuild();
        headers['x-client-build'] = CLIENT_BUILD;
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (code === 'RATE_LIMITED' && attempt < retries) { await sleep(5000 * (attempt + 1)); continue; }
      throw new ApiError(code, res.status, data?.error?.message || `Request failed (${res.status})`, data?.error?.details);
    }
  }

  get(p) { return this.raw(p); }
  post(p, body = {}, opts = {}) { return this.raw(p, { method: 'POST', body, ...opts }); }

  async refreshBuild() {
    try {
      const r = await fetch(`${API}/health`, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      if (j?.build) CLIENT_BUILD = j.build;
    } catch {}
  }

  async me() {
    const me = await this.get('/me');
    this.csrf = me.csrfToken || this.csrf;
    if (me.serverTime) this.serverOffsetMs = new Date(me.serverTime).getTime() - Date.now();
    this.save();
    return me;
  }

  // SIWE login: /auth/nonce -> sign message -> /auth/verify (same as the web app).
  async login({ referralCode = REFERRAL_CODE, humanToken } = {}) {
    await this.refreshBuild();
    const n = await this.post('/auth/nonce', { address: this.address, provider: 'siwe' });
    const signature = await this.account.signMessage({ message: n.message });
    const body = { provider: 'siwe', nonce: n.nonce, message: n.message, signature };
    if (referralCode) body.referralCode = referralCode;
    if (humanToken) body.humanToken = humanToken;
    const r = await this.post('/auth/verify', body);
    if (r?.csrfToken) this.csrf = r.csrfToken;
    this.save();
    return r;
  }

  // Use the saved session if it still works, else sign in again.
  async ensureSession() {
    try {
      return await this.me();
    } catch (e) {
      if (!(e instanceof ApiError) || ![401, 403].includes(e.status)) throw e;
    }
    this.log('Session expired, signing in with wallet...');
    this.cookies = {};
    this.csrf = null;
    await this.login();
    return this.me();
  }
}
