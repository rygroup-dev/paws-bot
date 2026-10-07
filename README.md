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
| Auto Grow (optional) | fills empty cat slots by buying the cheapest matching cat on the market, expands land, upgrades point stations (+15% output per level), upgrades the House when the next land tier needs it. Saves for the best target instead of wasting $PAWS |

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
Shows the account, $PAWS, resources/storage, every cat (level, stamina, job + countdown), the reward round, the eligibility status and bot stats.

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
| 📜 Permit & Rekrut | buy a Business Permit (odds shown), use tickets, choose fragment target, craft, recruit a cat, claim all |
| 👑 Membership | monthly pass (USDG, 30 days): members share a members-only pool. Shows last round's median payout. One-tap buy |
| 🤝 Referral | code, link, 📤 share, friends and earnings, ✏️ change your code |
| 🔒 Stake | lock $PAWS (cuts build/recruit time, counts as "spend or stake" for eligibility), unstake when unlocked |
| ✍️ Creator | join the creator program, connect X, submit post links → SPCX (SpaceX) token rewards |
| 🤝 Trade P2P | offer $PAWS for another player's cat, approve or cancel trades |
| 🎓 Tutorial | progress, auto on/off, skip |
| 🏆 Leaderboard | top players per board and your rank |
| ⚙️ Setting | every automation toggle, shift mode (auto/10…480), max shift, priority (points/resources), notifications, max spend per action, $PAWS reserve, repair threshold |
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
