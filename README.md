# 🐾 Paws of Sherwood Bot

Full-auto bot + Telegram control panel for **[Paws of Sherwood](https://pawsofsherwood.com/?ref=TGPEMVTV)**, the idle cat economy on Robinhood Chain where your cats work shifts and every round pays out in tokenized stocks and $PAWS.

Play the whole game from Telegram buttons: farming, cats, buildings, marketplace, buying $PAWS, rewards, membership, referral. Automation runs 24/7.

> New accounts made by this bot use referral **`TGPEMVTV`**. Join here: https://pawsofsherwood.com/?ref=TGPEMVTV

---

## ⚡ One-line install

**Windows** (PowerShell, no admin):
```powershell
irm https://raw.githubusercontent.com/rygroup-dev/paws-bot/main/install.ps1 | iex
```

**Linux / macOS** (installs a systemd service on Linux so it runs 24/7):
```bash
curl -fsSL https://raw.githubusercontent.com/rygroup-dev/paws-bot/main/install.sh | bash
```

The installer downloads the bot, a portable Node.js if you don't have Node 20+, the dependencies, and asks for:

| Asked | Where to get it |
| --- | --- |
| Private key | the wallet you play with (use a dedicated game wallet) |
| Telegram bot token | create a bot with [@BotFather](https://t.me/BotFather) → `/newbot` |
| Telegram chat id | leave empty: send any message to your bot, it replies with your chat id. Put it in `.env` and restart |

Run the installer again to update. It keeps your `.env` and `data/`.

On Windows the installer also adds a **Startup** shortcut, so the bot starts minimized every time you log in (a reboot or power cut doesn't stop the farm; set `PAWS_NO_AUTOSTART=1` before installing to skip it). On Linux the systemd service restarts it automatically.

### Manual install
```bash
git clone https://github.com/rygroup-dev/paws-bot && cd paws-bot
npm install
cp .env.example .env      # fill PRIVATE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
npm start                 # or run.cmd (Windows) / ./run.sh (Linux, macOS)
```

### First start of a new wallet
The game asks for a Cloudflare human check the first time a wallet signs in. The bot opens a small Edge/Chrome window: tick the box once. After that the session is saved in `data/` and it never asks again. On a server without a browser, run `run human` on a PC once and copy `data/` to the server.

---

## 🤖 What runs automatically

| Feature | What it does |
| --- | --- |
| Sign-in | SIWE sign-in with your wallet, session saved and renewed |
| Onboarding | creates a username, uses referral `TGPEMVTV` |
| Tutorial | completes all 27 steps by itself: first shift, free fast track, level ups, free permit, placing/moving/rotating the business, free 2nd cat, all visits |
| Shifts | claims finished shifts and starts new ones on the best station. Until reward-eligible: 10-min point shifts. After that: the longest shift stamina allows (8h = 118% efficiency) |
| Best station | ranks stations by **$ per hour**: points × what one point pays in that pool this round (pools with fewer players pay more) |
| Stamina | free 10-min rest in the House when stamina is low (paid quick nap optional) |
| Level ups | starts and resolves cat level ups (L1-L3 free; paid ones optional) |
| Upkeep | repairs stations below a set condition, emergency repair when broken |
| Claims | shifts, naps/rests, cat upgrades, station/house upgrades, land expansion, permits, crafts, recycling, recruits, rewards, plus the **on-chain collect** of stock and $PAWS rewards |
| Stations | claims the starter permit and places every new station on a free tile |
| Recruiting | uses free recruit credits and tickets |
| Auto Grow (optional) | the next land tier (and the House level it needs) as soon as it can be paid; until then the PAWS go into point-station levels (+15% output for every cat there), best pool per PAWS first, rather than sitting idle. Optionally buys the cheapest matching market cat for an empty slot |
| Materials | when a level up, the land or an upgrade is short of WOOD / ORE / FOOD, the idle cat that loses the fewest points goes to the station that makes it, on a shift just long enough to cover what is missing. The best producers stay on point stations |
| Waiting for a slot | a cat that can earn points but finds every point slot taken works elsewhere only until the first point slot frees up, instead of 8h at a pointless station |
| Level-up order | free levels first, then the strongest cats (highest productivity). Paid levels above the land's max effective level are skipped, they add no output until the land grows |
| Station slots (optional) | files a Business Permit when a station slot is empty, so every working cat earns points |
| Auto deposit (optional) | moves $PAWS sitting in the wallet (e.g. bought outside the bot) into the game |
| Safety | one bot per folder (lock refreshed every minute; a stale lock after a crash is ignored), network errors retried, RPC fallback |
| Log | every action in Telegram `/log` and in `data/bot.log`, with an hourly status line |

Every spend has a per-action ceiling and an optional reserve that is never touched. Everything can be switched on/off in ⚙️ Setting.

---

## 📱 Telegram

### Commands
| Command | Opens |
| --- | --- |
| `/menu` (or any text) | Dashboard |
| `/cats` | Cats |
| `/market` | Marketplace |
| `/wallet` | Wallet, buy / deposit / withdraw $PAWS |
| `/rewards` | Rewards and eligibility checklist |
| `/referral` | Referral code, link, stats |
| `/log` | Activity log |
| `/pause` / `/resume` | Stop / start automation |
| `/help` | Button guide |

Only the chat in `TELEGRAM_CHAT_ID` can control the bot.

### Dashboard
Shows the account, $PAWS, resources/storage, every cat (level, stamina, job + countdown), **⏳ everything running** (station/House upgrades, land expansion, level-up prep, recruits, permits, crafts, rests, each with its countdown), materials the bot is gathering, the reward round, the eligibility status and bot stats.

| Button | Does |
| --- | --- |
| 🔄 Refresh | reload data |
| ⏸ Pause / ▶️ Start | turn automation off/on |
| ⚡ Jalankan | run one automation cycle now |
| 🐱 Kucing · 🏗 Bangunan · ⏱ Shift | cats, buildings, active shifts |
| 🎁 Reward · 🛒 Market · 👛 Wallet | rewards, marketplace, wallet |
| 📜 Permit & Rekrut · 🎓 Tutorial · 🏆 Leaderboard | permit office + tavern, tutorial, leaderboards |
| 👑 Membership · 🤝 Referral · 🔒 Stake | monthly pass, referral, staking |
| ⚙️ Setting · 📋 Log · 💡 Strategi Cuan · ❓ Bantuan | settings, log, strategy guide, help |

### 🐱 Cats
Pick a cat to see rarity, profession, level/XP, stamina, stats, traits, jackpot chance and its current job.
| Button | Does |
| --- | --- |
| ⛏ Suruh kerja | choose station → choose shift length (🎁 = earns reward points, shows stamina cost) |
| 😴 Rest gratis | free 10-min rest (+15 stamina) |
| 💤 Quick nap | paid nap (confirm) |
| 📈 Level up | quote (XP, cost, chance, production gain), pick success chance, confirm. Always visible, shows why it can't run yet |
| ⭐ Jadikan main · 🛡 Protect · ✏️ Rename | main cat, favourite lock, rename |
| 💲 Jual di market | quick prices around the floor or a custom price (shows the 5% fee) |
| 🏷️ Batalkan listing · 🗑 Release | cancel a listing, release a cat (with preview + confirm) |

### 🏗 Buildings
List of all stations with level, condition, slots, resource and reward pool, the land expansion requirements, free cat slots and the **Auto Grow plan** (next 3 targets).
| Button | Does |
| --- | --- |
| ⬆️ Upgrade | station or House upgrade (cost + requirements shown) |
| 🛠 Repair · 🚑 Emergency repair | paid repair, free emergency repair when broken |
| ✅ Claim upgrade | finish an upgrade |
| 🔄 Putar · 📦 Simpan · 📍 Pasang | rotate, store, place on a free tile |
| 🏡 Perluas lahan | expand to the next land tier |

### ⏱ Shifts
Active shifts with countdown, output and points: ✅ Claim, ❌ Batal (shows if stamina is refunded), ⚡ Fast track (free or paid).

### 🎁 Rewards
Eligibility checklist (tutorial, cat level, point shifts x/5, $PAWS spent/staked), points and share per stock pool (AAPL, COST, TSLA, MSFT, AMZN, GOOGL, NVDA), the $PAWS pool, membership info, total earned and every allocation.
`💰 Claim & collect semua` claims and sends the on-chain collect; `Auto collect on-chain` toggles it.

### 🛒 Marketplace
Floor price per rarity and profession, your listings, recent sales.
`🔍 Semua listing` browses **all** listings with paging and filters: sort (cheapest, priciest, newest, level, stats, productivity, luck), rarity, profession, minimum level, name search. Each listing has `🛍 Beli` (confirm). The market sells cats; $PAWS is bought in Wallet and permits in the Permit Office.

### 👛 Wallet
Game balance, on-chain ETH / PAWS / USDG, live $PAWS price, deposits/withdrawals, referral.
| Button | Does |
| --- | --- |
| 🛒 Beli PAWS (ETH / USDG) | quote (amount out, minimum, fee, price impact) → confirm → swap on the game's Uniswap v4 pool → deposit to the game, same route as the website |
| ⬇️ Deposit | wallet PAWS → game (`all` or amount) |
| ⬆️ Withdraw | game → wallet (minimum set by the game) |
| 🔒 Stake · 👑 Membership · ✍️ Creator · 🤝 Trade P2P | see below |
| 🔗 Explorer | your address on Blockscout |

### More
| Menu | Does |
| --- | --- |
| 📜 Permit & Rekrut | 🍺 **cat gacha** (recruit: live odds, pity, expected market value), 📜 **station gacha** (Business Permit, odds shown), 🎯 fragment target (which blueprint the permits' fragments go to: GPU Farm / Trading Post / Sherwood Exchange), craft, tickets, claim all |
| 👑 Membership | monthly pass (USDG, 30 days): members share a members-only pool. Shows last round's median payout. One-tap buy |
| 🤝 Referral | code, link, 📤 share, friends and earnings, ✏️ change your code |
| 🔒 Stake | lock $PAWS (cuts build/recruit time, counts as "spend or stake" for eligibility), unstake when unlocked |
| ✍️ Creator | join the creator program, connect X, submit post links → SPCX (SpaceX) token rewards |
| 🤝 Trade P2P | offer $PAWS for another player's cat, approve or cancel trades |
| 🎓 Tutorial | progress, auto on/off, skip |
| 🏆 Leaderboard | top players per board and your rank |
| ⚙️ Setting | every automation toggle (incl. Auto Grow, buy market cats, auto deposit, collect on-chain), shift mode (auto/10…480), max shift, priority (points/resources), notifications, **max spend per action** (a per-purchase cap, not a daily budget), **$PAWS reserve** the bot never spends, repair threshold |
| 📋 Log | last 25 actions |
| 💡 Strategi Cuan | how to earn the most (below) |

---

## 💡 How to earn the most

1. **Get reward-eligible.** You need: tutorial done (automatic), a cat at level 3+ (automatic), 5 claimed **point-earning** shifts (≥10 min on a 🎁 station; tutorial shifts don't count, the bot does 10-min shifts until this is met), and **150 $PAWS of your own spent or staked**. A deposit alone doesn't count. Cheapest way: Wallet → Beli PAWS ~1 USDG, then a level up or station upgrade.
2. **Fill every active-cat slot.** Each land tier allows 3 / 5 / 8 / 12 / 20 working cats. A market cat (~500 $PAWS) is the biggest single gain.
3. **Upgrade point stations.** +15% output per level, more slots later.
4. **Work the pool that pays most per point.** The bot does this automatically using live pool data.
5. **Long shifts** once eligible: 8h shifts are 118% efficient and cost the least stamina per hour.
6. **Membership** puts your points in a second, members-only pool. More points means a bigger share.
7. **Referral**: 10% of what your friends spend.

Rewards: 7 tokenized stocks, the $PAWS pool, SPCX for creators. Cats are not NFTs; they live in the game and are traded on its marketplace.

### Game facts the bot is built on (read from the game's own config and texts)

- **What counts as "spent"**: $PAWS spent *in the game* (level ups, upgrades, recruiting, permits, repairs, naps, fast tracks, land) or staked. *"A deposit does not count"*, and marketplace purchases go to another player, so they don't count either.
- **Level ups**: XP only comes from working shifts (60 XP per hour). L1→L3 are free, and 100% chance is free too, so the bot always takes 100%. From L4, $PAWS is required on top of XP (150 / 225 / 300 / 450 / 600 by level band); $PAWS does not replace XP. Base chance 80% → 50% by level. A failure loses the $PAWS and materials but keeps level and XP, and adds +2% (max +10%) to the next try. The bot pays the base chance because it has the lowest cost per success (150 @ 80% ≈ 187 vs 375 @ 100%). Each level adds +3.47% output, up to your land tier's max effective level (10/20/30/40/50).
- **Getting cats**: the starter and your first recruit are free (account-bound). Event Cat Pack tickets give account-bound cats. Recruiting in the Tavern costs 1,500 $PAWS with official odds 51.75 / 27 / 14 / 6 / 1 / 0.25% (Common → Mythic), plus a guaranteed Rare+ every 10th recruit; the Permit & Rekrut screen shows a recruit's live expected market value. Or buy on the marketplace, usually the cheapest way to fill a slot. There is no shop, chest or bundle; the only paid pass is Membership.
- **More cats help up to your land's working limit** (3 / 5 / 8 / 12 / 20) and free station slots. After that, expand the land.

---

## 🛠 Tools

```
run.cmd / ./run.sh            # bot
run human                     # sign in again / create the account (captcha)
run explore                   # dump account data to data/explore
run probe                     # read-only check of every endpoint
run uitest                    # render every Telegram screen
run clicktest 6               # press every button (all writes stubbed)
run selftest 6                # N automation cycles without Telegram
```

## ⚙️ `.env`

| Key | |
| --- | --- |
| `PRIVATE_KEY` | wallet private key (never share) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram control |
| `REFERRAL_CODE` | referral for new accounts (default `TGPEMVTV`) |
| `RPC_URL` | optional Robinhood Chain RPC. Default: official, falling back to `https://robinhood.drpc.org` (for networks that block the official one) |

## 🔒 Safety

- `.env` and `data/` (session cookies) stay on your machine and are git-ignored. Never share them.
- Every action that spends $PAWS, USDG or ETH asks for confirmation. Automatic spending has a ceiling per action and a reserve.
- On-chain transactions are simulated first; one that would fail is never sent.
- Only one bot runs per folder (lock file).
- $PAWS is the game's currency, not an investment. Its value can fall.

## Layout

| File | |
| --- | --- |
| `src/api.js` | REST client, SIWE sign-in, session, retries, referral |
| `src/human.js` | one-time Turnstile check for new accounts |
| `src/game.js` | every game endpoint |
| `src/chain.js` | on-chain: buy, deposit, reward collect, membership |
| `src/engine.js` | automation loop and strategy |
| `src/telegram.js` | Telegram dashboard and buttons |
| `src/settings.js` | settings (editable from Telegram) |
| `install.ps1` / `install.sh` | one-line installers |
