// One-time account creation: the server wants a Cloudflare Turnstile token the first time a
// wallet signs in. Turnstile fails in automation-driven browsers (Playwright turns on the CDP
// Runtime domain, which Cloudflare detects), so this starts a plain Edge window and only uses
// the CDP Fetch domain to serve a bare captcha page at the game's own URL. The solved token is
// written to the tab title and read from /json/list, which never attaches to the page.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PawsClient, ApiError } from './api.js';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
];
const PORT = 9333;
const PAGE_URL = 'https://pawsofsherwood.com/bot-human-check';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pageHtml = (siteKey) => `<!doctype html><html><head><meta charset="utf-8"><title>Paws bot - human check</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=go&render=explicit" async defer></script>
<style>body{background:#0f0a06;color:#e7c873;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center}#s{color:#b39c74}</style>
</head><body><div><h2>Paws of Sherwood bot</h2><p>Centang kotak di bawah (sekali saja)</p><div id="ts"></div><p id="s"></p></div>
<script>
function go(){turnstile.render('#ts',{sitekey:${JSON.stringify(siteKey)},
 callback:function(t){document.getElementById('s').textContent='OK! Jendela ini akan tertutup sendiri.';document.title='PAWS_TOKEN:'+t},
 'error-callback':function(c){document.getElementById('s').textContent='Error '+c+', coba klik lagi';document.title='PAWS_ERR:'+c;return false},
 'expired-callback':function(){document.title='Paws bot - human check'}})}
</script></body></html>`;

async function listTabs() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

export async function getHumanToken(siteKey, log = console.log) {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Akun baru butuh captcha sekali, tapi Edge/Chrome tidak ditemukan di mesin ini. Jalankan "run human" di PC yang ada browser-nya, lalu salin folder data/ ke sini.');
  const proc = spawn(exe, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.resolve('data', 'browser-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=560,720', 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    let tab;
    for (let i = 0; i < 40 && !tab; i++) {
      try { tab = (await listTabs()).find((t) => t.type === 'page'); } catch {}
      if (!tab) await sleep(500);
    }
    if (!tab) throw new Error('Could not reach the browser');

    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    let id = 0;
    const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
    ws.on('message', (buf) => {
      const m = JSON.parse(buf);
      if (m.method !== 'Fetch.requestPaused') return;
      send('Fetch.fulfillRequest', {
        requestId: m.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(pageHtml(siteKey)).toString('base64'),
      });
    });
    send('Fetch.enable', { patterns: [{ urlPattern: PAGE_URL, requestStage: 'Request' }] });
    await sleep(300);
    send('Page.navigate', { url: PAGE_URL });
    log('Jendela captcha terbuka. Centang kotaknya (batas 10 menit).');

    const deadline = Date.now() + 10 * 60 * 1000;
    let lastErr = '';
    while (Date.now() < deadline) {
      await sleep(1000);
      let tabs;
      try { tabs = await listTabs(); } catch { throw new Error('Jendela browser ditutup'); }
      const t = tabs.find((x) => x.title?.startsWith('PAWS_'));
      if (t?.title.startsWith('PAWS_TOKEN:')) return t.title.slice('PAWS_TOKEN:'.length);
      if (t?.title.startsWith('PAWS_ERR:') && t.title !== lastErr) { lastErr = t.title; log(`Turnstile ${t.title}`); }
    }
    throw new Error('Captcha timeout (10 min)');
  } finally {
    try { ws?.close(); } catch {}
    proc.kill();
  }
}

// Sign in, solving the human check when the server asks for it.
export async function loginWithHumanCheck(client, referralCode) {
  try {
    return await client.login({ referralCode });
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'HUMAN_CHECK_REQUIRED') throw e;
    client.log('Server minta human check (akun baru), membuka browser...');
    const humanToken = await getHumanToken(e.details.siteKey, client.log);
    return client.login({ referralCode, humanToken });
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const c = new PawsClient({ privateKey: process.env.PRIVATE_KEY, dataDir: path.resolve('data') });
  console.log('Wallet:', c.address);
  try {
    const r = await loginWithHumanCheck(c);
    console.log('Login OK.', r?.isNewUser ? '(akun baru)' : '', r?.needsUsername ? 'butuh username' : '');
  } catch (e) {
    console.error('Gagal:', e.code ?? '', e.message, JSON.stringify(e.details ?? {}));
    process.exit(1);
  }
}
