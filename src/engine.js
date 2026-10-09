// The automation loop: onboarding, tutorial, farming, upkeep and claiming.
import { ApiError } from './api.js';

const n = (v) => Number(v ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Longest material-gathering shift for a cat working outside its profession (minutes).
const GATHER_OFF_MAX = 60;
const ACK_STEPS = new Set(['WELCOME', 'MEET_THE_PLOT', 'TOWN_DIRECTORY', 'MANAGE_BUSINESS', 'FIRST_BUSINESS', 'MANAGE_CATS', 'CAT_RULES', 'GROW_YOUR_LAND', 'FINISH']);
const VISIT_PLACE = {
  VISIT_TRAINER: 'TRAINER', VISIT_TAVERN: 'TAVERN', VISIT_REWARDS: 'REWARDS', VISIT_MARKET: 'MARKET',
  VISIT_LEADERBOARD: 'LEADERBOARD', VISIT_STAKING: 'STAKING',
};
const ADJ = ['Swift', 'Lucky', 'Brave', 'Sly', 'Merry', 'Bold', 'Quiet', 'Golden', 'Misty', 'Royal'];
const NOUN = ['Paw', 'Whisker', 'Archer', 'Fox', 'Outlaw', 'Ranger', 'Tabby', 'Kitten', 'Oak', 'Arrow'];

export class Engine {
  constructor({ game, settings, notify = () => {}, log = console.log }) {
    this.g = game;
    this.s = settings;
    this.notifyFn = notify;
    this.logFn = log;
    this.state = {};       // last snapshot shown on the dashboard
    this.logs = [];
    this.stats = { claims: 0, jobsStarted: 0, levelUps: 0, rewardsClaimed: 0, startedAt: Date.now(), lastTick: null, lastError: null };
    this.cfg = null;
    this.timer = null;
    this.busy = false;
    this.cache = {};
  }

  log(msg, level = 'info') {
    const line = `${new Date().toLocaleTimeString('id-ID', { hour12: false })} ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 80) this.logs.shift();
    this.logFn(line);
    const mode = this.s.get('notify');
    if (mode === 'all' || (mode === 'important' && level === 'important')) this.notifyFn(msg);
  }

  // Calls an action and turns API errors into a log line instead of an exception.
  async try(label, fn, { quiet = false } = {}) {
    try {
      return await fn();
    } catch (e) {
      const msg = `${label}: ${e instanceof ApiError ? `${e.code} - ${e.message}` : e.message}`;
      // The same failure repeats every tick; report it once per 10 minutes.
      this.seenErrors ??= new Map();
      const last = this.seenErrors.get(msg) ?? 0;
      if (!quiet && Date.now() - last > 600000) this.log(`⚠️ ${msg}`);
      this.seenErrors.set(msg, Date.now());
      this.lastFailure = msg;
      return null;
    }
  }

  // ---------- snapshot
  async refresh() {
    if (!this.cfg) this.cfg = (await this.g.config()).config;
    const me = await this.g.c.ensureSession();
    const st = { me, at: Date.now() };
    this.spent = 0;   // the fresh balance already includes earlier spending
    if (!me.onboarding?.needsUsername) {
      const [property, tutorial] = await Promise.all([
        this.g.property(),
        me.onboarding?.needsTutorial ? this.g.tutorial().catch(() => null) : null,
      ]);
      st.property = property;
      st.cats = property.cats ?? (await this.g.cats()).cats;
      st.tutorial = tutorial;
    }
    this.state = { ...this.state, ...st };
    return this.state;
  }

  async slow(key, everyMs, fn) {
    const c = this.cache[key];
    if (c && Date.now() - c.at < everyMs) return c.v;
    const v = await fn().catch(() => c?.v ?? null);
    this.cache[key] = { at: Date.now(), v };
    return v;
  }

  // Game balance minus what this tick already spent (the snapshot is only refreshed per tick).
  balance() { return n(this.state.me?.balances?.cat) - (this.spent ?? 0); }
  canSpend(cost) { return n(cost) <= this.balance() - n(this.s.get('keepPaws')) && n(cost) <= this.s.get('maxSpendPerAction'); }

  // ---------- loop
  start() {
    if (this.timer) return;
    const loop = async () => {
      let wait = this.s.get('tickSeconds') * 1000;
      if (this.s.get('running')) {
        try {
          wait = await this.tick();
        } catch (e) {
          this.stats.lastError = `${e.code ?? ''} ${e.message}`;
          this.log(`❌ Tick error: ${e.code ?? ''} ${e.message}`);
          wait = 60000;
        }
      }
      this.timer = setTimeout(loop, Math.max(5000, wait));
    };
    this.timer = setTimeout(loop, 1000);
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  async runNow() {
    if (this.busy) return;
    await this.tick();
  }

  async tick() {
    if (this.busy) return 5000;
    this.busy = true;
    try {
      await this.refresh();
      const st = this.state;
      if (st.me.onboarding?.needsUsername) {
        await this.onboard();
        return 3000;
      }
      if (this.s.get('autoTutorial') && st.tutorial?.active) await this.tutorialStep();
      const claimed = this.stats.claims;
      await this.claimTimers();
      // Cats freed by a claim are idle now: refresh so they can level up before the next shift.
      if (this.stats.claims !== claimed) await this.refresh();
      this.needed = new Map();   // resource -> amount missing for level ups / growth this tick
      if (this.s.get('autoLevelUp')) await this.levelUps();
      if (this.s.get('autoRepair')) await this.repairs();
      if (this.s.get('autoPermits')) await this.permitsAndStations();
      if (this.s.get('autoRecruit') || this.inTutorial()) await this.recruiting(false, !this.inTutorial());
      if (this.s.get('autoUpgradeBuildings')) await this.grow();
      if (this.s.get('autoDepositWallet')) await this.slow('autoDeposit', 300000, () => this.autoDeposit());
      if (this.s.get('autoClaimRewards')) await this.claimRewards();
      else await this.slow('rewards', 120000, () => this.g.rewards()).then((rw) => { if (rw) this.state.rewards = rw; });
      if (this.s.get('autoFarm')) await this.farm();
      await this.refresh();
      this.stats.lastTick = Date.now();
      this.stats.lastError = null;
      const wait = this.nextWake();
      this.stats.nextTick = Date.now() + wait;
      this.heartbeat();
      return wait;
    } finally {
      this.busy = false;
    }
  }

  // Sleep until the next shift/nap ends (plus a little), but never longer than tickSeconds.
  nextWake() {
    const base = this.s.get('tickSeconds') * 1000;
    const ends = (this.state.property?.activeJobs ?? []).map((j) => new Date(j.endsAt).getTime() - this.g.c.now());
    const soon = ends.filter((t) => t > 0).sort((a, b) => a - b)[0];
    if (this.state.tutorial?.active) return Math.min(base, 8000);
    return soon !== undefined ? Math.min(base, soon + 3000) : base;
  }

  // ---------- onboarding
  async onboard() {
    for (let i = 0; i < 5; i++) {
      const name = `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}${Math.floor(100 + Math.random() * 9000)}`;
      const r = await this.try('username', () => this.g.setUsername(name));
      if (r) { this.log(`👤 Username dibuat: ${name}`, 'important'); return; }
      await sleep(1000);
    }
  }

  // ---------- tutorial
  async tutorialStep() {
    const t = this.state.tutorial;
    const step = t.current;
    const kind = t.steps.find((s) => s.step === step)?.kind;
    const p = this.state.property;
    const cats = this.state.cats ?? [];
    const starter = cats.find((c) => c.id === t.facts.starterCatId) ?? cats[0];
    const act = (label, fn) => this.try(`tutorial ${step}`, fn).then((r) => { if (r) this.log(`🎓 Tutorial: ${label}`); return r; });

    if (ACK_STEPS.has(step) || (kind === 'ACK' && !VISIT_PLACE[step])) return act(`${step} ✓`, () => this.g.tutorialAck(step));
    if (VISIT_PLACE[step]) return act(`kunjungi ${VISIT_PLACE[step]}`, () => this.g.tutorialVisit(VISIT_PLACE[step]));

    switch (step) {
      case 'FIRST_JOB': {
        if (starter?.activity === 'IDLE' && t.facts.lumberCampId) {
          const r = await act('shift pertama (3 menit)', () => this.g.startJob(starter.id, t.facts.lumberCampId, 3));
          if (r) this.stats.jobsStarted++;
        }
        return;
      }
      case 'FAST_TRACK': {
        const job = p.activeJobs.find((j) => j.fastTrack?.free && !j.fastTrack?.used) ?? p.activeJobs[0];
        if (job) return act('fast track gratis', () => this.g.fastTrack(job.id, '0.000000000000000000'));
        return;
      }
      case 'CLAIM_PERMIT': {
        await this.try('visit permit office', () => this.g.tutorialVisit('PERMIT_OFFICE'), { quiet: true });
        if (this.state.me.starterPermit?.status !== 'LOCKED') await this.claimStarterPermit();
        return;
      }
      case 'PLACE_BUSINESS': return this.deployStored();
      case 'MOVE_BUSINESS': {
        const b = this.firstBusiness();
        if (b) {
          const spot = this.freeSpot(b, b);
          if (spot) return act('pindah business', () => this.g.move(b.id, spot.x, spot.y, b.rotation ?? 0));
        }
        return;
      }
      case 'ROTATE_BUSINESS': {
        const b = this.firstBusiness();
        if (b) return act('putar business', () => this.g.rotate(b.id, 1));
        return;
      }
      case 'START_SECOND_CAT': {
        await this.try('visit tavern', () => this.g.tutorialVisit('TAVERN'), { quiet: true });
        return this.recruiting(true);
      }
      case 'RELEASE_PREVIEW': {
        const second = cats.find((c) => c.id === t.facts.secondCatId) ?? cats.find((c) => !c.isStarter);
        if (second) return act('lihat preview release (tidak release)', () => this.g.releasePreview(second.id));
        return;
      }
      default:
        return; // FACT steps (claim job, level, second cat working...) are completed by the normal loop
    }
  }

  inTutorial() { return !!this.state.tutorial?.active; }

  // ---------- claiming timers
  async claimTimers() {
    const p = this.state.property;
    const now = this.g.c.now();
    for (const j of p.activeJobs ?? []) {
      if (!(j.claimable || new Date(j.endsAt).getTime() <= now)) continue;
      let r = await this.try('claim', () => this.g.claimJob(j.id), { quiet: true });
      if (!r && this.s.get('dropOverflow')) r = await this.try('claim (drop overflow)', () => this.g.claimJob(j.id, true));
      if (r) {
        this.stats.claims++;
        const res = r.job?.result;
        const got = res?.resource ? `${res.resource.amount} ${res.resource.type}` : '';
        const pts = n(res?.gamePoints) > 0 ? ` +${n(res.gamePoints).toFixed(2)} pts` : '';
        const jp = r.job?.jackpot ? ` 🎰 JACKPOT ${r.job.jackpot.outcome ?? ''}` : '';
        this.log(`✅ Claim ${j.catName} @ ${j.buildingType}: ${got}${pts} +${res?.xp ?? 0}xp${jp}`, jp ? 'important' : 'info');
      }
    }
    // quick naps and free rests (house.quickNap.active / house.freeRest.active, flag `ready`)
    const naps = [...(p.house?.quickNap?.active ?? []), ...(p.house?.freeRest?.active ?? [])];
    if (naps.some((x) => x.ready || new Date(x.completesAt).getTime() <= now)) {
      const r = await this.try('claim nap/rest', () => this.g.claimNap(), { quiet: true });
      if (r) this.log(`😺 Istirahat selesai: ${naps.filter((x) => x.ready || new Date(x.completesAt).getTime() <= now).map((x) => x.catName).join(', ')}`);
    }
    // station upgrades finished (status UPGRADING with no time left)
    for (const b of p.buildings ?? []) {
      if (b.type === 'HOUSE' || b.status !== 'UPGRADING' || b.secondsRemaining > 0) continue;
      const r = await this.try(`claim upgrade ${b.name}`, () => this.g.claimBuildingUpgrade(b.id), { quiet: true });
      if (r) this.log(`🏗️ ${b.name} naik ke level ${b.level + 1}`, 'important');
    }
    if (p.house?.upgrade && (p.house.upgrade.claimable || new Date(p.house.upgrade.completesAt).getTime() <= now)) {
      const r = await this.try('claim house', () => this.g.claimBuildingUpgrade(p.house.buildingId), { quiet: true });
      if (r) this.log(`🏠 House naik ke level ${p.house.upgrade.toLevel}`, 'important');
    }
    if (p.expansion && (p.expansion.claimable || new Date(p.expansion.completesAt).getTime() <= now)) {
      const r = await this.try('claim expand', () => this.g.claimExpand(), { quiet: true });
      if (r) this.log(`🏡 Lahan diperluas ke tier ${p.expansion.toTier}!`, 'important');
    }
    // cat level-up attempts waiting to resolve
    const ups = await this.try('upgrades', () => this.g.upgrades(), { quiet: true });
    if (ups) this.state.upgrades = ups;
    for (const a of ups?.attempts ?? []) {
      if (a.resolvedAt) continue;
      const due = a.resolvable || (a.status === 'PREPARING' && new Date(a.readyAt).getTime() <= now);
      if (!due) continue;
      const r = await this.try('resolve upgrade', () => this.g.resolveUpgrade(a.id), { quiet: true });
      if (r) {
        const ok = r.success ?? r.attempt?.success ?? r.attempt?.outcome === 'SUCCESS';
        this.stats.levelUps += ok ? 1 : 0;
        this.log(ok ? `⭐ ${r.cat?.name ?? 'Cat'} naik level ${r.cat?.level ?? ''}!` : `💔 Level up ${r.cat?.name ?? ''} gagal`, 'important');
      }
    }
  }

  // ---------- level ups
  // Production weight of a cat: its productivity stat drives output (base 80% + up to 50% from
  // productivity), so the strongest cats get the PAWS first.
  catPower(cat) {
    return (n(this.cfg.production.productivityBaseBps) + (n(this.cfg.production.productivityScaleBps) * n(cat.stats?.productivity)) / 100) / 10000;
  }

  async levelUps() {
    const cands = [];
    for (const cat of this.state.cats ?? []) {
      // canAttemptUpgrade is also false when materials are short, so go by XP and ask for a
      // quote: its requirements say exactly what is missing.
      const xpReady = cat.canAttemptUpgrade || (cat.level < cat.levelCap && cat.xp >= cat.xpToNext);
      if (!xpReady || cat.pendingUpgradeId || cat.activity !== 'IDLE') continue;
      const q = await this.try('quote', () => this.g.upgradeQuote(cat.id, 0), { quiet: true });
      if (!q) continue;
      if (!q.canUpgrade) {
        this.noteMissing(q.requirements?.items);
        const why = q.requirements?.items?.filter((i) => !i.met).map((i) => `${i.label} ${Math.floor(n(i.have))}/${Math.ceil(n(i.need))}`).join(', ');
        if (why) this.logOnce(`lvl:${cat.id}:${why}`, `⏳ Level up ${cat.name} L${q.currentLevel}→${q.targetLevel} tertunda: kurang ${why}`);
        continue;
      }
      // Pick the chance with the lowest expected $PAWS per success. Free levels (L1-3) cost 0 at
      // every chance, so that is 100%. For paid levels, cost/chance is lowest at the base chance
      // (e.g. 150 @80% = 187 per success vs 375 @100%); a failure keeps level and XP.
      const best = [...q.stops].sort((a, b) => n(a.catCost) / a.chanceBps - n(b.catCost) / b.chanceBps || b.chanceBps - a.chanceBps)[0];
      const cost = n(best.catCost);
      // Levels above the land's max effective level add nothing to output (gain.capped):
      // don't pay for them until the land grows.
      if (cost > 0 && q.gain?.capped) {
        this.logOnce(`cap:${cat.id}`, `⏸️ Level up ${cat.name} ditahan: L${q.targetLevel} di atas batas efektif lahan (L${this.state.property?.maxEffectiveLevel}), tidak menambah produksi`);
        continue;
      }
      cands.push({ cat, q, best, cost });
    }
    // Free levels first, then the strongest cats (most output gained per level).
    cands.sort((a, b) => (a.cost > 0) - (b.cost > 0) || this.catPower(b.cat) - this.catPower(a.cat));
    for (const { cat, q, best, cost } of cands) {
      if (cost > 0 && !(this.s.get('levelUpSpendPaws') && this.canSpend(cost))) continue;
      const pct = Math.round(best.chanceBps / 100);
      const r = await this.try(`level up ${cat.name}`, () => this.g.startUpgrade(cat.id, pct, best.catCost));
      if (r) {
        this.spent += cost;
        this.log(`📈 Level up ${cat.name} → L${q.targetLevel} dimulai (peluang ${pct}%, biaya ${cost} PAWS)`);
      }
    }
  }

  // One-line status every hour so a quiet log still shows the bot is alive and what's next.
  statusLine() {
    const p = this.state.property;
    const t = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
    const jobs = (p?.activeJobs ?? []).map((j) => `${j.catName} ${j.buildingType} s/d ${t(j.endsAt)}`).join(' · ');
    const reasons = this.state.rewards?.eligibility?.reasons ?? [];
    return `🕒 Status: ${p?.activeCats?.working ?? 0}/${p?.activeCats?.limit ?? '-'} kucing kerja${jobs ? ` (${jobs})` : ''} · ${Math.floor(this.balance())} PAWS · ${reasons.length ? `belum eligible: ${reasons.join(', ')}` : 'eligible reward ✅'}`;
  }

  heartbeat() {
    if (Date.now() - (this.lastBeat ?? 0) < 3600000) return;
    this.lastBeat = Date.now();
    this.log(this.statusLine());
  }

  // Record missing materials (requirement items of kind RESOURCE) so farming can produce them.
  noteMissing(items) {
    for (const i of items ?? []) {
      if (i.met || i.kind !== 'RESOURCE' || !i.resource) continue;
      this.needed.set(i.resource, Math.max(this.needed.get(i.resource) ?? 0, n(i.missing)));
    }
  }

  // Log a message at most once per hour per key (for states that repeat every tick).
  logOnce(key, msg) {
    this.onceSeen ??= new Map();
    if (Date.now() - (this.onceSeen.get(key) ?? 0) < 3600000) return;
    this.onceSeen.set(key, Date.now());
    this.log(msg);
  }

  // ---------- repairs
  async repairs() {
    for (const b of this.state.property.buildings ?? []) {
      if (!b.hostsJobs || b.activeJobs > 0) continue;
      if (b.broken && b.emergencyRepair?.available) {
        const r = await this.try(`emergency repair ${b.name}`, () => this.g.emergencyRepair(b.id, b.emergencyRepair.catCost));
        if (r) this.log(`🛠️ Emergency repair ${b.name}`, 'important');
        continue;
      }
      if (!b.repair?.needed || b.condition >= this.s.get('repairBelow') || !b.repair.affordable) continue;
      const cost = n(b.repair.catCost);
      if (cost > 0 && !(this.s.get('repairSpendPaws') && this.canSpend(cost))) continue;
      const r = await this.try(`repair ${b.name}`, () => this.g.repair(b.id, b.repair.catCost));
      if (r) this.log(`🛠️ Repair ${b.name} (kondisi ${b.condition}%)`);
    }
  }

  // ---------- permits & stations
  async claimStarterPermit() {
    const r = await this.try('starter permit', () => this.g.starterPermit(), { quiet: true });
    if (r) this.log(`📜 Permit gratis diklaim: ${r.permit?.type ?? r.building?.type ?? r.type ?? 'business'}`, 'important');
    await this.claimPermits();
    return r;
  }

  async claimPermits() {
    const pm = await this.try('permits', () => this.g.permits(), { quiet: true });
    if (!pm) return;
    this.state.permits = pm;
    const now = this.g.c.now();
    const ready = (x) => x && (x.claimable || x.ready || (x.completesAt && new Date(x.completesAt).getTime() <= now)) && !x.claimedAt;
    for (const p of pm.active ?? []) {
      if (!ready(p)) continue;
      const r = await this.try('claim permit', () => this.g.claimPermit(p.id));
      if (r) this.log(`📜 Permit selesai: ${r.building?.name ?? r.result?.name ?? r.permit?.result?.name ?? 'business baru'}`, 'important');
    }
    for (const c of pm.crafts ?? []) if (ready(c)) await this.try('claim craft', () => this.g.claimCraft(c.id));
    for (const c of pm.recycling?.active ?? []) if (ready(c)) await this.try('claim recycle', () => this.g.claimRecycle(c.id));
  }

  async permitsAndStations() {
    // starter permit status: LOCKED | READY | CLAIMED | DISABLED
    if (this.state.me.starterPermit?.status === 'READY') await this.claimStarterPermit();
    await this.slow('permits', 60000, () => this.claimPermits());
    await this.deployStored();
  }

  firstBusiness() {
    return (this.state.property.buildings ?? []).find((b) => !b.core && b.source !== 'STARTER' && b.deployed);
  }

  // All buildings not placed on the plot (fresh permits or stored ones).
  undeployed() {
    const p = this.state.property;
    return [...(p.storage ?? []), ...(p.buildings ?? []).filter((b) => b.deployed === false)];
  }

  async deployStored() {
    for (const b of this.undeployed()) {
      if (b.canDeploy === false && b.status !== 'STORED' && !b.storedAt) continue;
      const spot = this.freeSpot(b);
      if (!spot) { this.log(`⚠️ Tidak ada tempat kosong untuk ${b.name}`); continue; }
      const r = await this.try(`deploy ${b.name}`, () => this.g.deploy(b.id, spot.x, spot.y, 0));
      if (r) {
        this.log(`🏗️ ${b.name} dipasang di (${spot.x},${spot.y})`, 'important');
        await this.refresh();
      }
    }
  }

  // First free top-left position on the plot for `b` (optionally ignoring b's own tiles).
  freeSpot(b, ignore) {
    const p = this.state.property;
    const size = p.size;
    const w = b.footprint?.w ?? b.w ?? 2;
    const h = b.footprint?.h ?? b.h ?? 2;
    const taken = (p.buildings ?? []).filter((o) => o.deployed && o.id !== ignore?.id);
    const overlaps = (x, y) => taken.some((o) => {
      const ow = o.footprint?.w ?? o.w; const oh = o.footprint?.h ?? o.h;
      return x < o.x + ow && x + w > o.x && y < o.y + oh && y + h > o.y;
    });
    const cur = ignore ? `${ignore.x},${ignore.y}` : null;
    for (let y = 0; y + h <= size; y++) {
      for (let x = 0; x + w <= size; x++) {
        if (`${x},${y}` === cur) continue;
        if (!overlaps(x, y)) return { x, y };
      }
    }
    return null;
  }

  // ---------- recruiting
  // Claims finished recruits; starts a new one when free (or forced by the tutorial).
  async recruiting(force = false, mayStart = true) {
    const rc = await this.try('recruitments', () => this.g.recruitments(), { quiet: true });
    if (!rc) return;
    this.state.recruit = rc;
    const now = this.g.c.now();
    for (const r of [...(rc.active ?? []), ...(rc.recruitments ?? [])]) {
      const ready = r.claimable || r.ready || (r.readyAt && new Date(r.readyAt).getTime() <= now) || (r.completesAt && new Date(r.completesAt).getTime() <= now);
      if (!ready || r.claimedAt) continue;
      const known = new Set((this.state.cats ?? []).map((c) => c.id));
      const got = await this.try('claim recruit', () => this.g.claimRecruit(r.id));
      let cat = got?.cat ?? got?.recruitment?.cat ?? got?.cats?.[0];
      // The claim reply doesn't always carry the cat: it is the one cat we didn't have before.
      if (got && !cat?.rarity) {
        const list = await this.try('cats', () => this.g.cats(), { quiet: true });
        const cats = list?.cats ?? (Array.isArray(list) ? list : null);
        if (cats) { this.state.cats = cats; cat = cats.find((c) => !known.has(c.id)) ?? cat; }
      }
      if (got) this.log(`🐱 Kucing baru: ${cat?.name ?? 'cek menu Kucing'}${cat ? ` (${cat.rarity} ${cat.profession})` : ''}`, 'important');
    }
    if ((rc.active ?? []).some((r) => !r.claimedAt)) return;
    if (!mayStart && !force) return;
    const cost = n(rc.costs?.cat);
    const free = cost === 0 || rc.firstRecruitCredit?.applies;
    const useTicket = !free && rc.canStartWithTicket;
    if (!(free && rc.canStart) && !useTicket) {
      if (force && rc.blockers?.length) this.log(`🍺 Rekrut belum bisa: ${rc.blockers.join(', ')}`);
      return;
    }
    const r = await this.try('recruit', () => this.g.recruit(!!useTicket, rc.costs?.cat ?? '0'));
    if (r) this.log(`🍺 Rekrut kucing dimulai${useTicket ? ' (pakai ticket)' : free ? ' (gratis)' : ''}`, 'important');
  }

  // ---------- growth: stations / land / house (opt-in, spends $PAWS)
  // Station levels raise output (+15% per level, config.buildings[].levels.outputMultiplierBps),
  // so point-earning stations come first, best-paying pool first. Land expansion (more stations
  // and active cats) is taken as soon as it unlocks. The House earns nothing itself; it is only
  // upgraded when the next land tier needs it. If the top target is not affordable yet, the bot
  // saves for it instead of spending on something weaker.
  growPlan() {
    const p = this.state.property;
    const vpp = new Map((this.state.rewards?.pools ?? []).map((pl) => [pl.category, n(pl.prizeQuote) / Math.max(1, n(pl.totalPoints))]));
    const plan = [];
    const nt = p.nextTier;
    // The next land tier is the biggest step (more working cats, station slots, better stations),
    // so it leads the plan as soon as we own enough cats; its materials are gathered meanwhile.
    if (nt?.meetsCats) plan.push({ kind: 'land', name: `Lahan → ${nt.name}`, cost: nt.catCost, ready: !!(nt.canExpand && nt.requirements?.met), prio: 0, reqs: nt.requirements?.items });
    for (const b of p.buildings ?? []) {
      if (!b.pointsCategory || !b.nextLevel || b.type === 'HOUSE') continue;
      plan.push({ kind: 'building', id: b.id, name: `${b.name} L${b.nextLevel.level}`, cost: b.nextLevel.catCost, ready: !!b.nextLevel.canUpgrade, prio: 1, value: vpp.get(b.pointsCategory) ?? 0, reqs: b.nextLevel.requirements?.items });
    }
    const houseNeeded = nt?.requirements?.items?.some((i) => i.kind === 'HOUSE' && !i.met);
    const h = p.house?.nextLevel;
    // A House level the land tier asks for comes right before the land itself.
    if (h && !p.house.upgrade && houseNeeded) plan.push({ kind: 'building', id: p.house.buildingId, name: `House L${h.level} (syarat lahan)`, cost: h.catCost, ready: !!h.requirements?.met, prio: nt?.meetsCats ? -1 : 2, reqs: h.requirements?.items });
    plan.sort((a, b) => a.prio - b.prio || n(a.cost) - n(b.cost) || (b.value ?? 0) - (a.value ?? 0));
    return plan;
  }

  // A free active-cat slot is the biggest gain (one more worker), and a market cat usually costs
  // a fraction of a recruit. Buy the cheapest listing whose profession matches a point station.
  async fillCatSlots() {
    const p = this.state.property;
    const cats = this.state.cats ?? [];
    if (cats.length >= (p.activeCats?.limit ?? 0)) return false;
    const wanted = new Set((p.buildings ?? []).filter((b) => b.pointsCategory && b.hostsJobs).map((b) => b.preferredProfession).filter(Boolean));
    const floor = await this.g.marketFloor().catch(() => null);
    const res = await this.try('market', () => this.g.market({ sort: 'price_asc', limit: 30 }), { quiet: true });
    const ok = (res?.listings ?? []).filter((l) => !l.isMine && l.status === 'ACTIVE' && this.canSpend(l.price) && n(l.price) <= n(floor?.byRarity?.[l.cat.rarity] ?? l.price) * 1.1);
    const pick = ok.find((l) => wanted.has(l.cat.profession)) ?? ok[0];
    if (!pick) return false;
    const r = await this.try(`beli kucing ${pick.cat.name}`, () => this.g.buyListing(pick.id));
    if (r) this.spent += n(pick.price);
    if (r) this.log(`🐱 Beli kucing ${pick.cat.name} (${pick.cat.rarity} ${pick.cat.profession} L${pick.cat.level}) seharga ${n(pick.price)} PAWS`, 'important');
    return !!r;
  }

  // An empty station slot means a cat works somewhere without points. A Business Permit fills it
  // (every station a permit can roll earns points), so file one when the slot is free.
  async fillStationSlots() {
    const pm = this.state.permits ?? (await this.try('permits', () => this.g.permits(), { quiet: true }));
    if (!pm || pm.stations.deployed + (pm.stations.stored ?? 0) >= pm.stations.slots) return false;
    if ((pm.active ?? []).length || pm.concurrency?.active >= pm.concurrency?.max) return false;
    if (!pm.canStart) { this.noteMissing(pm.costRequirements?.items); return false; }
    if (!this.canSpend(pm.cost.cat)) return false;
    const r = await this.try('permit', () => this.g.buyPermit(false, pm.cost.cat));
    if (!r) return false;
    this.spent += n(pm.cost.cat);
    this.cache.permits = null;
    this.log(`📜 Permit diajukan untuk slot stasiun kosong (${n(pm.cost.cat)} PAWS, ${pm.hours} jam)`, 'important');
    return true;
  }

  async grow() {
    const p = this.state.property;
    if (this.s.get('autoBuyCats') && (await this.fillCatSlots())) return;
    if (this.s.get('autoFillStations') && (await this.fillStationSlots())) return;
    const queue = p.propertyQueue ?? { used: 0, slots: 1 };
    if (queue.used >= queue.slots || p.expansion) return;
    const plan = this.growPlan();
    // Gather materials for the land step (House + land) and the first station upgrade meanwhile.
    const firstStation = plan.find((x) => x.prio === 1);
    for (const x of plan.filter((x) => !x.ready && (x.prio <= 0 || x === firstStation))) this.noteMissing(x.reqs);
    // Land (and the House level it needs) when it can be paid now. Otherwise don't sit on the
    // PAWS waiting for it: a point-station level (+15% output for every cat there) pays back far
    // sooner than saving thousands for the next tier.
    const land = plan.find((x) => x.prio <= 0 && x.ready && this.canSpend(x.cost));
    const pick = land ?? plan.filter((x) => x.prio === 1 && x.ready && this.canSpend(x.cost)).sort((a, b) => (b.value ?? 0) / n(b.cost) - (a.value ?? 0) / n(a.cost))[0];
    if (!pick) return;
    const r = await this.try(`grow ${pick.name}`, () => (pick.kind === 'land' ? this.g.expand(pick.cost) : this.g.upgradeBuilding(pick.id, pick.cost)));
    if (r) {
      this.spent += n(pick.cost);
      this.log(`🏗️ Upgrade ${pick.name} dimulai (${n(pick.cost)} PAWS)`, 'important');
    }
  }

  // ---------- farming
  durations() { return this.cfg.jobs.durations.map((d) => d.minutes); }

  pickMinutes(longestAffordable) {
    if (this.inTutorial()) return longestAffordable >= 3 ? 3 : null;
    const mode = this.s.get('shiftMode');
    const ds = this.durations();
    if (mode !== 'auto') {
      const m = Number(mode);
      return m <= longestAffordable ? m : null;
    }
    // Reward eligibility needs a few claimed shifts first: do short point-earning shifts until then.
    const needActivity = this.state.rewards?.eligibility?.reasons?.includes('NOT_ENOUGH_ACTIVITY');
    if (this.s.get('fastActivity') && needActivity) return longestAffordable >= this.s.get('minShift') ? this.s.get('minShift') : null;
    const cap = Math.min(this.s.get('maxShift'), longestAffordable);
    const ok = ds.filter((d) => d <= cap && d >= this.s.get('minShift'));
    return ok.length ? ok[ok.length - 1] : null;
  }

  async farm() {
    const p = this.state.property;
    const working = p.activeCats?.working ?? 0;
    let capacity = (p.activeCats?.limit ?? 3) - working;
    let idle = (this.state.cats ?? []).filter((c) => c.activity === 'IDLE' && !c.listingId && !c.pendingUpgradeId && !c.isAcclimating);
    if (!idle.length || capacity <= 0) return;

    const stations = (p.buildings ?? []).filter((b) => b.hostsJobs && b.canStartJob && b.deployed && b.status === 'ACTIVE' && b.slots - b.activeJobs > 0 && b.condition >= (this.cfg.wear?.minConditionToStart ?? 1));
    // During the tutorial's first job, the starter must work the Lumber Camp.
    const probeMinutes = this.inTutorial() ? 3 : this.s.get('minShift');
    const rankings = new Map();
    for (const b of stations) {
      const r = await this.try(`ranking ${b.name}`, () => this.g.workerRanking(b.id, probeMinutes), { quiet: true });
      if (r) rankings.set(b.id, r);
    }

    const free = new Map(stations.map((b) => [b.id, b.slots - b.activeJobs]));
    const preferPoints = this.s.get('prefer') === 'points';
    // $ value of one point in each stock pool this round (prize / total points). Pools with few
    // contributors pay far more per point, so a point there is worth more than elsewhere.
    const vpp = new Map((this.state.rewards?.pools ?? []).map((pl) => [pl.category, n(pl.prizeQuote) / Math.max(1, n(pl.totalPoints))]));
    const avgV = [...vpp.values()].reduce((a, b) => a + b, 0) / Math.max(1, vpp.size) || 1;
    const rested = new Set();
    // Materials already being gathered: a short shift (the gathering kind) on a station that makes
    // a needed material. Cats on long shifts don't count, their output lands hours later.
    const gathering = new Set((p.activeJobs ?? [])
      .filter((j) => j.durationMinutes <= Math.max(this.s.get('minShift'), GATHER_OFF_MAX))
      .map((j) => (p.buildings ?? []).find((b) => b.id === j.buildingId)?.producesResource)
      .filter((r) => r && this.needed?.has(r)));
    // What each idle cat would earn on its best point station (weighted points per hour). The cat
    // that loses the least by leaving the point stations is the one sent to gather materials.
    const pointValue = (b, o) => {
      const hours = o.projection?.hours || probeMinutes / 60;
      return (n(o.projection?.gamePoints) / hours) * (b.pointsCategory ? (vpp.get(b.pointsCategory) ?? avgV) / avgV : 0);
    };
    const bestPoints = new Map();
    for (const b of stations) {
      if (!b.pointsCategory) continue;
      for (const o of rankings.get(b.id)?.options ?? []) if (!o.blocker) bestPoints.set(o.catId, Math.max(bestPoints.get(o.catId) ?? 0, pointValue(b, o)));
    }
    while (idle.length && capacity > 0) {
      let best = null;
      for (const b of stations) {
        if (!(free.get(b.id) > 0)) continue;
        for (const o of rankings.get(b.id)?.options ?? []) {
          const cat = idle.find((c) => c.id === o.catId);
          if (!cat || o.blocker) continue;
          const minutes = this.pickMinutes(o.longestAffordableMinutes ?? 0);
          if (!minutes) continue;
          const hours = o.projection?.hours || probeMinutes / 60;
          const pts = n(o.projection?.gamePoints) / hours;
          const resPerHour = n(o.perHour);
          // Points weighted by how much the station's pool pays per point (relative to average).
          const weight = b.pointsCategory ? (vpp.get(b.pointsCategory) ?? avgV) / avgV : 0;
          let score = (preferPoints ? pts * weight * 100 : pts * weight * 5) + resPerHour + (o.professionMatch ? 1 : 0);
          // A material we are short of (blocking a level up or upgrade) beats points for now.
          const forNeed = b.producesResource && this.needed?.get(b.producesResource) > 0 && !gathering.has(b.producesResource);
          // Gathering goes to the idle cat that gives up the fewest points; a matching profession
          // (1.25x material) only breaks near-ties, it never pulls the best producer off points.
          if (forNeed) score += 1e6 - (bestPoints.get(cat.id) ?? 0) * 1000 + (o.professionMatch ? 50 : 0) + resPerHour;
          // Gather with the shortest shift that covers what is missing at this station's rate
          // (10 min still earns points), never longer than the cat could otherwise work.
          // A cat outside its profession gathers at most GATHER_OFF_MAX minutes, so it is soon
          // back at a station that suits it instead of spending 8h at the wrong one.
          let m = minutes;
          if (forNeed) {
            const need = this.needed.get(b.producesResource);
            let fits = this.durations().filter((d) => d >= this.s.get('minShift') && d <= minutes);
            if (!o.professionMatch) fits = fits.filter((d) => d <= GATHER_OFF_MAX).concat(fits.length && fits[0] > GATHER_OFF_MAX ? [fits[0]] : []);
            m = fits.find((d) => (resPerHour * d) / 60 >= need) ?? fits[fits.length - 1] ?? minutes;
          }
          if (!best || score > best.score) best = { cat, b, minutes: m, score, forNeed };
        }
      }
      if (!best) break;
      // A cat that can earn points but finds every point slot taken should not sit 8h at a
      // pointless station: work only until the first point slot frees up, then move over.
      if (!best.b.pointsCategory && !best.forNeed && (bestPoints.get(best.cat.id) ?? 0) > 0) {
        const now = this.g.c.now();
        const pointBusy = (p.activeJobs ?? []).filter((j) => (p.buildings ?? []).find((b) => b.id === j.buildingId)?.pointsCategory);
        const freeIn = Math.min(...pointBusy.map((j) => (new Date(j.endsAt).getTime() - now) / 60000));
        if (Number.isFinite(freeIn)) {
          const fits = this.durations().filter((d) => d >= this.s.get('minShift') && d <= best.minutes);
          const m = [...fits].reverse().find((d) => d <= Math.max(freeIn, this.s.get('minShift'))) ?? fits[0];
          if (m && m < best.minutes) best.minutes = m;
        }
      }
      const r = await this.try(`start job ${best.cat.name}`, () => this.g.startJob(best.cat.id, best.b.id, best.minutes));
      idle = idle.filter((c) => c.id !== best.cat.id);
      if (r) {
        this.stats.jobsStarted++;
        capacity--;
        free.set(best.b.id, free.get(best.b.id) - 1);
        this.log(`⛏️ ${best.cat.name} kerja di ${best.b.name} ${best.minutes} menit${best.forNeed ? ` (cari ${best.b.producesResource} untuk level up/upgrade)` : ''}`);
        if (best.forNeed) gathering.add(best.b.producesResource);   // one gatherer per material is enough
        if (this.inTutorial() && r.job?.fastTrack?.free) await this.try('free fast track', () => this.g.fastTrack(r.job.id, '0.000000000000000000'), { quiet: true });
      }
    }

    // Cats left idle had no affordable shift: rest them.
    for (const cat of idle) {
      if (rested.has(cat.id) || cat.stamina >= cat.maxStamina - 1) continue;
      if (this.s.get('autoRest')) {
        const fr = p.house?.freeRest;
        if (fr?.enabled && fr.used < fr.slots) {
          const r = await this.try(`rest ${cat.name}`, () => this.g.rest(cat.id), { quiet: true });
          if (r) { this.log(`😴 ${cat.name} istirahat gratis (+${fr.staminaRestored} stamina)`); fr.used++; rested.add(cat.id); continue; }
        }
      }
      if (this.s.get('autoNap')) {
        const qn = p.house?.quickNap;
        if (qn && qn.used < qn.slots && this.canSpend(qn.catCost)) {
          const r = await this.try(`nap ${cat.name}`, () => this.g.nap(cat.id, qn.catCost));
          if (r) { this.log(`💤 ${cat.name} quick nap (${n(qn.catCost)} PAWS)`); qn.used++; }
        }
      }
    }
  }

  // ---------- wallet -> game
  // $PAWS bought outside the bot lands in the wallet; the game only credits what is deposited
  // into its vault, so move it in (approve + vault.deposit, a little ETH for gas).
  async autoDeposit() {
    if (!this.chain) return null;
    const bal = await this.chain.balances().catch(() => null);
    if (!bal || Number(bal.paws) < this.s.get('autoDepositMin')) return null;
    if (Number(bal.eth) <= 0) { this.logOnce('dep-gas', `⚠️ Ada ${Math.floor(Number(bal.paws))} PAWS di wallet tapi ETH untuk gas kosong`); return null; }
    this.log(`⬇️ Auto deposit ${Number(bal.paws).toFixed(2)} PAWS dari wallet ke game...`, 'important');
    const r = await this.try('auto deposit', () => this.chain.deposit(bal.raw.paws, (m) => this.log(m)));
    if (r) {
      this.log(r.credited ? `✅ Deposit ${Number(bal.paws).toFixed(2)} PAWS masuk ke game (tx ${r.txHash.slice(0, 10)}…)` : `⏳ Deposit terkirim, menunggu konfirmasi (tx ${r.txHash.slice(0, 10)}…)`, 'important');
      await this.refresh();
    }
    return r;
  }

  // ---------- rewards
  // Allocations waiting for us: ALLOCATED+claimable (claim first) or a claim whose collect is READY.
  pendingAllocations(rw) {
    return (rw?.allocations ?? []).filter((a) => (a.status === 'ALLOCATED' && a.claimable) || (a.claimId && ['READY', 'PREPARING'].includes(a.collect)));
  }

  async claimRewards(force = false) {
    const rw = force ? await this.g.rewards() : await this.slow('rewards', 120000, () => this.g.rewards());
    if (!rw) return [];
    this.state.rewards = rw;
    const done = [];
    for (const a of this.pendingAllocations(rw)) {
      const onchain = a.collect && a.collect !== 'SIMULATED';
      if (onchain && !this.s.get('autoCollectOnchain') && !force) continue;
      const r = await this.try(`claim reward ${a.symbol}`, () => (this.chain ? this.chain.collectReward(a, (m) => this.log(m)) : this.g.claimReward(a.id)));
      if (!r) continue;
      this.stats.rewardsClaimed++;
      done.push(r);
      const s = r.symbol ?? a.symbol;
      const what = `${r.amount ?? a.amount} ${s === 'CAT' ? 'PAWS' : s}`;   // API name for in-game $PAWS is CAT
      if (r.collected) this.log(`💰 Reward ${what} masuk wallet ${r.txHash ? `(tx ${r.txHash.slice(0, 10)}…)` : ''}`, 'important');
      else if (r.credited) this.log(`💰 Reward ${what} dikreditkan ke game`, 'important');
      else if (r.held) this.log(`⏳ Reward ${what} ditahan untuk review admin`, 'important');
      else this.log(`ℹ️ Reward ${what}: status ${r.state}`);
    }
    if (done.length) this.cache.rewards = null;
    return done;
  }
}
