# Paws of Sherwood Bot

Auto-farm bot + Telegram control panel for [Paws of Sherwood](https://pawsofsherwood.com/?ref=TGPEMVTV), the idle cat economy on Robinhood Chain.

Everything the web game does, from Telegram buttons:

- **Full auto**: sign-in with your wallet, username, the whole tutorial, shifts (claim + restart), free rest / paid nap, cat level-ups, repairs, starter permit, placing new stations, recruiting, reward claiming
- **Smart shifts**: 10-minute point shifts until you are reward-eligible, then the longest shift stamina allows (8h = 118% efficiency)
- **Cats**: send to work (pick station and length), rest, nap, level up with chosen odds, rename, protect, set main, sell, release
- **Stations & land**: upgrade, repair, emergency repair, rotate, store/place, house upgrade, land expansion
- **Marketplace**: floor prices, cheapest/newest/best-stat listings per rarity, buy, sell (quick or custom price), cancel, recent sales
- **P2P trades**: offer $PAWS for another player's cat, confirm, cancel
- **Rewards**: points per pool, eligibility explained, claim + on-chain collect of tokenized stocks (AAPL, COST, TSLA, MSFT, AMZN, GOOGL, NVDA) and the $PAWS pool
- **Wallet (on-chain)**: ETH / PAWS / USDG balances, live PAWS price, **buy PAWS with ETH or USDG** (same Uniswap v4 route as the game), deposit wallet → game, withdraw game → wallet
- **Staking, Membership (monthly pass, USDG), Creator program (SPCX for X posts), Referral**
- Permits (buy, tickets, fragment target, craft), Tavern, Leaderboards, live log, settings, strategy guide

Every action that spends $PAWS, USDG or ETH asks for confirmation first.

## Setup

1. Node.js 20+ (Windows: the bot also works with a portable Node in `.runtime/node`)
2. `npm install`
3. Copy `.env.example` to `.env` and fill `PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
4. Start: `run.cmd` (Windows) or `npm start`

New wallet? The first sign-in needs a one-time Cloudflare human check: the bot opens a small Edge/Chrome window, tick the box once. The session is saved in `data/`, so it is not asked again. New accounts are created with referral `TGPEMVTV` (change `REFERRAL_CODE` in `.env` if you want).

Send `/menu` to your Telegram bot for the dashboard. Commands: `/menu`, `/pause`, `/resume`, `/log`, `/cats`, `/market`.

## Tools

```
run.cmd            # bot (engine + Telegram)
run.cmd human      # sign in again / create account (one-time captcha)
run.cmd explore    # dump account data to data/explore/
run.cmd probe      # read-only check of every endpoint the bot uses
run.cmd uitest     # render every Telegram screen without sending (catches errors)
run.cmd selftest 6 # run N automation cycles without Telegram
```

## Notes

- If your network blocks `rpc.mainnet.chain.robinhood.com` (some ISP / office filters do), on-chain calls fall back to `https://robinhood.drpc.org`, or set `RPC_URL`.
- Use a dedicated game wallet. `.env` and `data/` (session cookies) must never be shared.
- $PAWS is the game's currency, not an investment; its value can fall.

## Layout

| File | What |
| --- | --- |
| `src/api.js` | REST client, SIWE sign-in, session, retries |
| `src/human.js` | one-time Turnstile check for new accounts |
| `src/game.js` | every game endpoint |
| `src/chain.js` | on-chain: buy, deposit, collect rewards, membership |
| `src/engine.js` | automation loop |
| `src/telegram.js` | Telegram dashboard and buttons |
| `src/settings.js` | settings (editable from Telegram) |
