// Bot settings, persisted to data/settings.json and editable from Telegram.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  running: true,          // master switch for the automation loop
  autoTutorial: true,     // finish onboarding + tutorial by itself
  autoFarm: true,         // claim finished shifts and start new ones
  shiftMode: 'auto',      // 'auto' = longest shift the stamina allows (capped by maxShift), or a fixed minute value
  maxShift: 480,          // cap for auto mode (minutes)
  minShift: 10,           // shortest shift in auto mode; 10+ earns reward points
  prefer: 'points',       // 'points' (reward pools) or 'resources'
  autoRest: true,         // free 10-min rest when stamina is too low
  autoNap: false,         // paid quick nap (spends $PAWS)
  autoLevelUp: true,      // level cats up when XP is ready
  levelUpSpendPaws: false,// allow level-ups that cost $PAWS
  autoRepair: true,       // repair stations below repairBelow condition
  repairBelow: 50,
  repairSpendPaws: true,
  autoClaimRewards: true,
  autoCollectOnchain: true, // send the on-chain claim tx for stock/PAWS rewards (tiny ETH gas)
  fastActivity: true,       // until 5 shifts are claimed, use 10-min shifts so rewards unlock sooner
  autoPermits: true,      // claim finished permits / crafts / recycling, deploy new stations
  autoRecruit: true,      // use free recruit credits / tickets
  autoUpgradeBuildings: false, // Auto Grow: spend $PAWS on station / land / house upgrades
  autoBuyCats: false,     // Auto Grow: buy a market cat when an active-cat slot is empty
  autoDepositWallet: false, // move $PAWS sitting in the wallet into the game (on-chain, ETH gas)
  autoDepositMin: 10,     // only when the wallet holds at least this many $PAWS
  dropOverflow: true,     // when storage is full, still claim (losing the overflow) instead of stalling
  maxSpendPerAction: 1000,// $PAWS ceiling for any single automatic purchase
  keepPaws: 0,            // $PAWS reserve automatic spending never touches
  tickSeconds: 45,
  notify: 'important',    // 'all' | 'important' | 'off'
};

export class Settings {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'settings.json');
    this.v = { ...DEFAULTS };
    try { Object.assign(this.v, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch {}
  }
  get(k) { return this.v[k]; }
  set(k, val) {
    this.v[k] = val;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.v, null, 2));
  }
  toggle(k) { this.set(k, !this.v[k]); return this.v[k]; }
}
