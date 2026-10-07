// Small display helpers shared by the Telegram UI.
export const n = (v) => Number(v ?? 0);
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function num(v, d = 2) {
  const x = n(v);
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e4) return `${(x / 1e3).toFixed(1)}k`;
  return x.toLocaleString('en-US', { maximumFractionDigits: d });
}

export function dur(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d}h ${h}j`;
  if (h) return `${h}j ${m}m`;
  if (m) return `${m}m ${s}d`;
  return `${s}d`;
}

export const until = (iso, now = Date.now()) => (iso ? dur((new Date(iso).getTime() - now) / 1000) : '-');
export const ago = (t) => (t ? `${dur((Date.now() - new Date(t).getTime()) / 1000)} lalu` : '-');

export function bar(value, max, width = 10) {
  const f = Math.max(0, Math.min(width, Math.round((n(value) / Math.max(1, n(max))) * width)));
  return '▰'.repeat(f) + '▱'.repeat(width - f);
}

export const RES_ICON = { WOOD: '🪵', ORE: '🪨', FOOD: '🍎', ENERGY: '⚡', COMPONENTS: '⚙️' };
export const ACT_ICON = { IDLE: '💤 idle', WORKING: '⛏️ kerja', NAPPING: '😴 tidur', RESTING: '😴 rest', UPGRADING: '📈 upgrade', LISTED: '🏷️ dijual' };
export const RARITY_ICON = { COMMON: '⚪', UNCOMMON: '🟢', RARE: '🔵', EPIC: '🟣', LEGENDARY: '🟠', MYTHIC: '🔴' };
