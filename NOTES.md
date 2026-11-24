# Start 'Em: project notes (handoff for any AI or developer)

> Paste this file at the start of a chat with any AI assistant so it's caught up.
> Last updated: 2026-11-23. Update the "Current status" section when things change.

## What it is
**Start 'Em** is a daily NFL fantasy football guessing game, in the style of 82-0 and Immaculate Grid.
You get a random NFL team-season (1999–2025) and pick one player from that roster without seeing any stats. You choose which lineup spot he goes in, and then his full-PPR season total is revealed.
Seven rolls fill **QB, RB, RB, WR, WR, TE, FLEX**. Your score is the lineup's total points, and it earns a "season record" badge (0-14 up to 14-0).

- **Live site:** https://startem.app (playstartem.com redirects to it)
- **Repo:** github.com/msilverberg1401/start-em (branch `main`)
- **Socials:** @StartEmApp (only X so far)
- **Launch:** Daily #1 was Sun 2026-11-22

### Design goals (from the owner)
- Ball knowledge should matter most. Replaying shouldn't give anyone an edge, and a perfect team should be nearly impossible.
- The UI should look great, never bland. The game should be shareable in group chats like 82-0, and the goal is to go viral.
- **Before changing any game-balance numbers** (record cutoffs, SR, tiers, rerolls), explain the idea and ask first. Don't tune them unasked.

## Modes
| Mode | Login | Rerolls | Notes |
|---|---|---|---|
| **Daily** | Not needed to play. Login is needed to post the score | none | Same rolls for everyone, one per account per day, resets at midnight ET. Logged-out players can play, then log in and the game gets "claimed" onto their account (`claimDaily`, protected by `guestKey`). |
| **Ranked** | Required | 1 team + 1 year | Deeper rosters (more backups/traps). No restarting. Skill Rating (SR) ladder. |
| **Casual** | No | 1 team + 1 year | Stats on (games played, usage, years in the NFL) as hints. There's a Stats on/off switch. No leaderboard. |
| **Past Dailies** (`archive`) | Optional | none | Replay an earlier Daily. It doesn't count on the board. |
| **Challenge** | Optional | copies the source game's rules | A friend gets your exact rolls, then sees head to head. A challenge from today's Daily sends them to the Daily instead. |
| **Live 1v1** | Host only (friend can be a guest) | none | Real-time match from an invite link (`?live=<id>`). Same 7 teams, 30s to lock each pick, both picks revealed together (5s), then the next team. A missed pick gets the worst player left. Rematch button. Server code: `supabase/functions/game/live.ts`, table `matches`. The browser polls `liveState` every 1.5s. |

**Themed Dailies** (`themeFor()` in `game.ts`): Throwback Thursday (1999–2009), Division Sunday (rotating division), Thanksgiving (Lions + Cowboys), Champions Daily (SB winners, on Super Bowl Sunday).

**Other features:** Groups (private standings joined by a 6-character code, max 10 per user), Profile (streaks with one auto streak-freeze per week, history calendar, best lineup, SR/tier, lifetime stats, and a Live 1v1 W–L–T record), Daily standings with a 7-day back stepper, viewing others' lineups (only after you've finished that Daily), Daily stats ("how everyone picked"), a PWA you can install, a daily push reminder at 10am ET, and an owner-only stats page (`adminStats`).

## Scoring rules (all server side)
- **Pick grade:** best (🟩, ≥99.9% of the best eligible player on that roll for that slot), close (🟨, ≥75%), miss (🟥).
- **Season record:** `RECORD = { floor: 900, perfect: 2100 }`. Wins scale linearly between those numbers. **14-0 requires 2,100+ points AND all seven picks green**. Otherwise the max is 13-1. The record formula stays on the server so the cutoff can't be read from the site's code.
- **% / accuracy:** your total ÷ the best possible lineup from the rolls you actually got (`optimalLineup`).
- **Ranked SR:** start at 800 (`START_SR`). Each game moves SR by (your % − `expectedPct(sr)`) × k, capped at ±60 (±120 in placements). Gains shrink above 2000. Season bonus: +2/+4/+6 for 11-3/12-2/13-1, and +15 for 14-0. There are 5 placement games, and they count double and can't place you above All-Pro (1999).
- **Tiers:** Rookie 0, Starter 600, Pro Bowl 1200, All-Pro 1600, MVP 2000 (each has divisions III/II/I), Hall of Fame 2500+.
- `scripts/ranked_sim.mjs` simulates the ladder for tuning.

## Stack (all free tiers)
- **Frontend:** plain HTML/CSS/JS with no framework or build step, in `site/`. Hosted on **GitHub Pages**.
- **Backend:** a **Supabase** edge function `game` (Deno/TypeScript) that owns all game state, plus Supabase Postgres and Supabase Auth.
- **Auth:** Google OAuth + email one-time codes (sent by **Brevo** SMTP).
- **Domain/DNS:** Cloudflare (startem.app). A **Cloudflare Worker** (`worker/`) serves rich link previews for `/c/*` challenge links.
- **Push reminders:** Web Push (VAPID). The `reminders` edge function is triggered by pg_cron.

## File map
```
site/                      the website (GitHub Pages)
  index.html               the single page
  app.js                   ~100 KB: all UI, screens, API calls, game flow
  style.css                ~79 KB: all styling (light + dark)
  share.js                 share card image + share text
  teams.js                 team names/colors
  config.js                placeholder. The deploy workflow overwrites it with real values
  sw.js, manifest.webmanifest, icons, og-image.png, privacy.html, 404.html
supabase/
  functions/game/
    index.ts               HTTP entry: CORS, reads the login token, calls handle()
    api.ts                 every API action (see below). Storage is injected so tests can run it
    game.ts                rules: modes, seeded rolls, themes, grading, record, SR/tiers, streaks
    store.ts               database reads/writes (Supabase client)
    rolls.json             ~2 MB player data: every team-season roster with full-PPR points
  functions/reminders/     daily push reminder sender
  migrations/              SQL schema (run in date order)
  config.toml
worker/share-worker.js     Cloudflare Worker for challenge link previews (+ wrangler.toml)
scripts/build_data.py      rebuilds rolls.json from nflverse weekly stats
scripts/ranked_sim.mjs     Ranked ladder simulator
test-build/                runs the real API in the browser with fake logins + local storage (testing only)
.github/workflows/
  site.yml                 deploys site/ to Pages on push to main (only when site/** changes)
  backend.yml              deploys Supabase migrations + functions
README.md                  full one-time setup guide (Supabase, Google, Brevo, domain, push, worker)
```

## How it works
- The browser **never** touches database tables directly. Every table has Row Level Security on and no policies. Only the `game` edge function (service role) reads and writes.
- The browser POSTs `{ action: "...", ...params }` to `/functions/v1/game`, with the login token if signed in.
- **Anti-cheat:** points stay on the server until a pick is locked. Rosters are sorted alphabetically so the order can't leak who scored most. The Daily's rolls are seeded with the secret `DAILY_SALT` so nobody can compute future Dailies from the public code. Daily lineups are never used as link previews (they'd be spoilers).

**API actions (`api.ts`):** live: `liveCreate`, `liveJoin`, `liveState`, `livePick`, `liveRematch` (in `live.ts`); `me`, `setUsername`, `start` (daily/ranked/casual/archive/challenge), `pick`, `reroll`, `claimDaily`, `dayCard`, `scorecard`, `dailyStats`, `archiveList`, `leaderboard` (daily/week/ranked/alltime, optional group), `createGroup`, `joinGroup`, `leaveGroup`, `profile`, `challengeInfo`, `uploadCard`, `savePush`, `deletePush`, `adminStats`.

**Database tables:** `profiles`, `games` (state is stored as JSON. Indexes enforce one Daily per user per day and one active Ranked game), `daily_results`, `ranked_stats`, `best_lineups`, `groups`, `group_members`, `user_stats`, `stat_counts` (owner counters), `matches` (live 1v1, saved with a version check so two requests can't overwrite each other), plus push subscriptions and the `cards` storage bucket.

## Config and secrets (names only, never paste the values into a chat)
- **GitHub Actions secrets:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
- **GitHub Actions variables:** `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL`, `SHARE_BASE`, `VAPID_PUBLIC_KEY`
- **Supabase Edge Function secrets:** `DAILY_SALT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SITE_URL`, `CRON_SECRET`, optional `ADMIN_EMAILS`

## ⚠️ Don't break these
- **Never change `DAILY_SALT`** or the seeding in `rollQueue`/`dailyQueue`, or every past Daily reshuffles.
- **Daily #1 (2026-11-22) must stay unchanged.** It was played before the salt existed, so `SALT_FROM = "2026-11-23"` keeps its original rolls. Friends played it and asked to keep it as is.
- **`LAUNCH = "2026-11-22"`** sets the Daily numbering. Don't change it.
- Don't add database policies that let the browser read tables directly, because that would leak answers.
- Don't send points, finishes or the record cutoffs to the browser before a pick is locked.
- Ask before changing balance numbers (see Design goals).

## Deploying
Push to `main`. `site.yml` redeploys the site when `site/**` changes, and `backend.yml` redeploys Supabase. Both can also be run by hand from the GitHub **Actions** tab. Browsers fetch new copies after each deploy because the CSS/JS links are versioned automatically.

## Testing
`test-build/` runs the real `api.ts` in the browser with a memory store and fake logins (any email + any 6-digit code works). It also has a "Fill with fake players" button. It's for trying changes without touching the live database.

## Rebuilding player data
Download nflverse `stats_player_week_YYYY.csv` for 1999–2025 into `data_raw/`, then run:
`python3 scripts/build_data.py data_raw supabase/functions/game/rolls.json`
(The script also fixes 2001–02 rows where nflverse tagged a player with the opponent's team.)

## Current status (2026-11-23)
- Live and working on startem.app: Google login, Brevo email codes, daily reminders, groups, challenges, Ranked.
- Recently shipped:
  - The Daily is playable without logging in (log in afterwards to save the score)
  - Casual Stats on/off switch
  - Daily standings stepper for the last 7 days
  - Reopening and sharing past scorecards, and seeing top players' lineups after you finish
  - Owner stats page
  - Social links in the footer
  - Speed improvements
  - A first-game guide
  - Phone layout fixes
- Next / ideas:
  - Grow on socials (X created. Other platforms and DMs to fantasy creators still to do)
  - Possibly an app-store version later

## Starting a session with a new AI
> "I'm working on Start 'Em, a live web game. Here are my project notes: [paste this file]. The code is at github.com/msilverberg1401/start-em. Today I want to: ___. Ask before changing any game-balance numbers, and don't touch the Daily seeding/salt."

Then paste whichever files you're changing (usually `site/app.js`, `site/style.css`, or `supabase/functions/game/api.ts` / `game.ts`).
