// Every game action the web client can perform, as plain async methods.
// Bodies match what /assets/*.js sends (see the mutate() payloads in the bundle).
const enc = encodeURIComponent;

export class Game {
  constructor(client) {
    this.c = client;
  }

  // ---- reads
  me() { return this.c.me(); }
  property() { return this.c.get('/property'); }
  cats() { return this.c.get('/cats'); }
  cat(id) { return this.c.get(`/cats/${id}`); }
  jobs(status = 'ACTIVE') { return this.c.get(`/jobs?status=${status}`); }
  job(id) { return this.c.get(`/jobs/${id}`); }
  tutorial() { return this.c.get('/tutorial'); }
  rewards() { return this.c.get('/rewards'); }
  rewardsEarned() { return this.c.get('/rewards/earned'); }
  permits() { return this.c.get('/permits'); }
  recruitments() { return this.c.get('/recruitments'); }
  upgrades() { return this.c.get('/upgrades'); }
  upgradeQuote(catId, pct = 0) { return this.c.get(`/cats/${catId}/upgrade-quote?targetChancePct=${pct}`); }
  workerRanking(buildingId, minutes) { return this.c.get(`/buildings/${buildingId}/worker-ranking?minutes=${minutes}`); }
  wallet() { return this.c.get('/wallet'); }
  walletActivity() { return this.c.get('/wallet/activity'); }
  stakes() { return this.c.get('/stakes'); }
  notifications() { return this.c.get('/notifications'); }
  leaderboards() { return this.c.get('/leaderboards'); }
  leaderboard(key) { return this.c.get(`/leaderboards/${key}`); }
  referrals() { return this.c.get('/referrals/me'); }
  membership() { return this.c.get('/membership'); }
  config() { return this.c.get('/config/public'); }
  marketFloor() { return this.c.get('/marketplace/floor'); }
  marketMine() { return this.c.get('/marketplace/mine'); }
  marketRecent() { return this.c.get('/marketplace/recent-sales'); }
  market(params = {}) {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${enc(v)}`).join('&');
    return this.c.get(`/marketplace?${q}`);
  }
  listing(id) { return this.c.get(`/marketplace/${id}`); }
  trades() { return this.c.get('/trades'); }
  online() { return this.c.get('/hub/online'); }

  // ---- onboarding / tutorial
  setUsername(username) { return this.c.post('/onboarding/username', { username }, { idempotent: true }); }
  newName(username) { return this.c.post('/onboarding/new-name', { username }, { idempotent: true }); }
  tutorialAck(step) { return this.c.post('/tutorial/ack', { step }); }
  tutorialVisit(place) { return this.c.post('/tutorial/visit', { place }); }
  tutorialSkip() { return this.c.post('/tutorial/skip', {}); }
  tutorialEvent(event, step) { return this.c.post('/tutorial/event', { event, step }).catch(() => null); }

  // ---- cats & jobs
  startJob(catId, buildingId, minutes) { return this.c.post(`/cats/${catId}/start-job`, { buildingId, minutes }, { idempotent: true }); }
  claimJob(jobId, dropOverflow = false) { return this.c.post(`/jobs/${jobId}/claim`, dropOverflow ? { dropOverflow: true } : {}, { idempotent: true }); }
  cancelJob(jobId) { return this.c.post(`/jobs/${jobId}/cancel`, {}); }
  fastTrack(jobId, maxCatCost, tierId) {
    const body = { maxCatCost };
    if (tierId) body.tierId = tierId;
    return this.c.post(`/jobs/${jobId}/fast-track`, body, { idempotent: true });
  }
  rest(catId) { return this.c.post('/house/rest', { catId }, { idempotent: true }); }
  nap(catId, maxCatCost) { return this.c.post('/house/nap', { catId, maxCatCost }, { idempotent: true }); }
  claimNap() { return this.c.post('/house/nap/claim', {}); }
  napFastTrack(napId, maxCatCost) { return this.c.post(`/house/naps/${napId}/fast-track`, { maxCatCost }, { idempotent: true }); }
  startUpgrade(catId, targetChancePct, maxCatCost) { return this.c.post(`/cats/${catId}/start-upgrade`, { targetChancePct, maxCatCost }, { idempotent: true }); }
  resolveUpgrade(attemptId) { return this.c.post(`/upgrades/${attemptId}/resolve`, {}); }
  setMain(catId) { return this.c.post(`/cats/${catId}/set-main`, {}); }
  rename(catId, name) { return this.c.post(`/cats/${catId}/rename`, { name }); }
  protect(catId, on) { return this.c.post(`/cats/${catId}/protect`, { protected: on }); }
  releasePreview(catId) { return this.c.post(`/cats/${catId}/release/preview`, {}); }
  release(catId, confirm) { return this.c.post(`/cats/${catId}/release`, confirm === undefined ? {} : { confirm }); }

  // ---- buildings & land
  upgradeBuilding(buildingId, maxCatCost) { return this.c.post(`/buildings/${buildingId}/upgrade`, maxCatCost === undefined ? {} : { maxCatCost }, { idempotent: true }); }
  claimBuildingUpgrade(buildingId) { return this.c.post(`/buildings/${buildingId}/upgrade/claim`, {}); }
  repair(buildingId, maxCatCost) { return this.c.post(`/buildings/${buildingId}/repair`, maxCatCost === undefined ? {} : { maxCatCost }, { idempotent: true }); }
  emergencyRepair(buildingId, maxCatCost) { return this.c.post(`/buildings/${buildingId}/repair/emergency`, maxCatCost === undefined ? {} : { maxCatCost }, { idempotent: true }); }
  deploy(buildingId, x, y, rotation = 0) { return this.c.post(`/buildings/${buildingId}/deploy`, { x, y, rotation }); }
  move(buildingId, x, y, rotation = 0) { return this.c.post(`/buildings/${buildingId}/move`, { x, y, rotation }); }
  rotate(buildingId, turns = 1) { return this.c.post(`/buildings/${buildingId}/rotate`, { turns }); }
  store(buildingId) { return this.c.post(`/buildings/${buildingId}/store`, {}); }
  expand(maxCatCost) { return this.c.post('/property/expand', maxCatCost === undefined ? {} : { maxCatCost }, { idempotent: true }); }
  claimExpand() { return this.c.post('/property/expand/claim', {}); }
  rush(kind, timerId, tierId, maxCatCost) { return this.c.post('/rush', { kind, timerId, tierId, maxCatCost }, { idempotent: true }); }

  // ---- permits / recruitment
  starterPermit() { return this.c.post('/permits/starter', {}, { idempotent: true }); }
  buyPermit(useTicket, maxCatCost) { return this.c.post('/permits', { useTicket, maxCatCost }, { idempotent: true }); }
  claimPermit(permitId) { return this.c.post(`/permits/${permitId}/claim`, {}, { idempotent: true }); }
  permitTarget(target) { return this.c.post('/permits/target', { target }); }
  craft(body) { return this.c.post('/permits/craft', body, { idempotent: true }); }
  claimCraft(craftId) { return this.c.post(`/permits/craft/${craftId}/claim`, {}, { idempotent: true }); }
  recycle(buildingIds, maxCatCost) { return this.c.post('/permits/recycle', maxCatCost === undefined ? { buildingIds } : { buildingIds, maxCatCost }, { idempotent: true }); }
  claimRecycle(id) { return this.c.post(`/permits/recycle/${id}/claim`, {}, { idempotent: true }); }
  recruit(useTicket, maxCatCost) { return this.c.post('/recruitments', { useTicket, maxCatCost }, { idempotent: true }); }
  claimRecruit(id) { return this.c.post(`/recruitments/${id}/claim`, {}, { idempotent: true }); }

  // ---- rewards / staking / market
  claimReward(allocationId) { return this.c.post(`/rewards/${allocationId}/claim`, {}, { idempotent: true }); }
  stake(body) { return this.c.post('/stakes', body, { idempotent: true }); }
  unstake(stakeId) { return this.c.post(`/stakes/${stakeId}/unstake`, {}, { idempotent: true }); }
  listCat(catId, price) { return this.c.post('/marketplace/list', { catId, price: String(price) }, { idempotent: true }); }
  buyListing(listingId) { return this.c.post(`/marketplace/${listingId}/buy`, {}, { idempotent: true }); }
  cancelListing(listingId) { return this.c.post(`/marketplace/${listingId}/cancel`, {}); }
  readNotifications() { return this.c.post('/notifications/read', { all: true }); }

  // ---- P2P trades (schema: {counterpartyId, offer:{catIds,catAmount}, request:{catIds,catAmount}})
  trade(id) { return this.c.get(`/trades/${id}`); }
  createTrade(counterpartyId, offer, request) { return this.c.post('/trades', { counterpartyId, offer, request }, { idempotent: true }); }
  updateTrade(tradeId, catIds, catAmount) { return this.c.post(`/trades/${tradeId}/update`, { catIds, catAmount }); }
  confirmTrade(tradeId, summaryHash) { return this.c.post(`/trades/${tradeId}/confirm`, { summaryHash }); }
  cancelTrade(tradeId) { return this.c.post(`/trades/${tradeId}/cancel`, {}); }
  searchUsers(q) { return this.c.get(`/users/search?q=${enc(q)}`); }
  userProperty(userId) { return this.c.get(`/users/${userId}/property`); }
  userProfile(userId) { return this.c.get(`/users/${userId}/profile`); }

  // ---- creator program (X posts -> creator reward pool)
  creator() { return this.c.get('/creator'); }
  creatorJoin(countryCode, adult, acceptTerms) { return this.c.post('/creator/join', { countryCode, adult, acceptTerms }, { idempotent: true }); }
  creatorConnectX() { return this.c.post('/creator/x/connect', {}); }
  creatorDisconnectX() { return this.c.post('/creator/x/disconnect', {}); }
  creatorSubmit(url) { return this.c.post('/creator/submissions', { url, attest: true }, { idempotent: true }); }

  // ---- membership / referral code
  setReferralCode(code) { return this.c.post('/referrals/me/code', { code }); }
}
