# Start 'Em

**Who are you starting?** Roll a random NFL team-season (1999–2025), start one player blind, slot him, and see his full-PPR total. Seven rolls fill QB, RB, RB, WR, WR, TE, FLEX. Your score is your lineup's total points. A season record badge (up to 14-0) is based on raw points against a hidden server-side cutoff; 14-0 also needs all seven picks to be the best on their rolls (big points with a miss top out at 13-1).

- **Daily**: same rolls for everyone, one attempt per account per day (resets midnight ET), no rerolls. Themed days: **Throwback Thursday** (1999–2009 only), **Division Sunday** (one division, rotating weekly), **Thanksgiving** (Lions and Cowboys), **Champions Daily** (Super Bowl winners, on Super Bowl Sunday). Themes live in `themeFor()` in `game.ts`.
- **Ranked** (ball knowledge ladder): deeper rosters with more backups and traps, 1 team + 1 year reroll, no restarting. Skill rating (SR) moves each game by pick accuracy vs what's expected at your SR, plus a small bonus for big seasons (+2/+4/+6 for 11-3/12-2/13-1, +15 for 14-0). Tiers: Rookie, Starter, Pro Bowl, All-Pro, MVP (each III/II/I), Hall of Fame (2,500+). 5 placement games count double and can't place above All-Pro. Tuning lives in `game.ts` (TIERS, expectedPct, srChange, START_SR); `scripts/ranked_sim.mjs` simulates the ladder.
- **Casual** (stats on): per-game usage and NFL experience for each player, 1 team + 1 year reroll, no login needed, no leaderboard.
- **Past Dailies**: replay any earlier Daily for fun (doesn't count on the board).
- **Challenge a friend**: a link that gives a friend your exact rolls and rules, then shows head to head. A challenge from today's Daily sends them to play the Daily instead.
- **Groups**: private standings by 6-character code, next to the global standings.
- **Profile**: streaks, daily history, best lineup, ranked SR and tier, daily reminder toggle.
- **App + reminders**: installable to the home screen (PWA), with an optional once-a-day push reminder.

**Stack (all free):** GitHub Pages hosts the site (`site/`). Supabase handles logins, the database and the `game` edge function (`supabase/`), which keeps points hidden until a pick is locked.

---

## One-time setup (about 20 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com → **New project** (free plan). Save the **database password** you choose.
2. Grab these:
   - **Project ref**: the ID in your project URL, `https://supabase.com/dashboard/project/<project-ref>`
   - **Project URL** and **anon / publishable key**: Project Settings → API
   - **Access token**: your avatar → Account → **Access Tokens** → Generate

### 2. Connect the GitHub repo
In the repo: **Settings → Secrets and variables → Actions**.

| Type | Name | Value |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | access token from step 1 |
| Secret | `SUPABASE_DB_PASSWORD` | database password from step 1 |
| Variable | `SUPABASE_PROJECT_REF` | project ref |
| Variable | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| Variable | `SUPABASE_ANON_KEY` | anon / publishable key (safe to be public) |
| Variable | `SITE_URL` | your site URL, e.g. `https://<github-user>.github.io/start-em/` |

Then **Settings → Pages → Source: GitHub Actions**.

Supabase → **Edge Functions → Secrets**: add `DAILY_SALT` (any long random string). It keeps Dailies from being computed out of this public code. Set it before launch and never change it, or past Dailies reshuffle.

Go to the **Actions** tab and run both workflows (**Deploy Supabase backend**, then **Deploy site to GitHub Pages**). After that they run automatically on every push.

### 3. Tell Supabase where the site lives
Supabase → **Authentication → URL Configuration**:
- **Site URL**: your `SITE_URL`
- **Redirect URLs**: add the same URL

### 4. Turn on Google login
1. console.cloud.google.com → create a project → **APIs & Services → OAuth consent screen** (External, app name "Start 'Em").
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Copy the Client ID and Client secret into Supabase → **Authentication → Sign In / Providers → Google** and enable it.

### 5. Turn on email codes (Brevo, free)
Supabase's built-in email sender only allows a couple of emails an hour and is for testing, so connect a real sender:
1. Sign up at brevo.com (free plan). Add and verify a sender. With a domain, authenticate the domain too so codes don't land in spam.
2. Brevo → **SMTP & API → SMTP** to get the login and an SMTP key.
3. Supabase → **Authentication → Emails → SMTP Settings** → enable custom SMTP:
   host `smtp-relay.brevo.com`, port `587`, username = Brevo SMTP login, password = SMTP key, sender = your verified address, sender name "Start 'Em".
4. Supabase → **Authentication → Rate Limits**: raise "emails sent per hour" (the default with custom SMTP is 30).
5. Supabase → **Authentication → Emails → Templates**: in both **Magic Link** and **Confirm signup**, replace the body with a code version, for example:
   ```html
   <h2>Your Start 'Em code</h2>
   <p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
   ```

### 6. Set launch day
`LAUNCH` in `supabase/functions/game/game.ts` sets which day is Daily #1. Change it to your launch date and push.

### Optional: custom domain
Buy a domain, then GitHub → Settings → Pages → **Custom domain**, and add the DNS records GitHub shows you. Update `SITE_URL`, Supabase's Site URL and Redirect URLs, and authenticate the domain in Brevo.

### 7. Daily reminders (push notifications)
1. Make keys once: `npx web-push generate-vapid-keys`.
2. GitHub → Settings → Secrets and variables → Actions → **Variables**: add `VAPID_PUBLIC_KEY` (the public key).
3. Supabase → Edge Functions → **Secrets**: add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:you@example.com`), `SITE_URL` (your site address) and `CRON_SECRET` (any long random string).
4. Supabase → Database → Extensions: turn on **pg_cron** and **pg_net**. Then in the SQL editor run (fill in your project ref and the same CRON_SECRET):
```sql
select cron.schedule('start-em-reminders', '0 15 * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/reminders',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR-CRON-SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);
```
That sends one reminder a day at 10am ET. On iPhone, reminders only work after someone adds Start 'Em to their home screen (the site walks them through it).

### 8. Rich link previews for challenges (needs a custom domain)
Every link gets the Start 'Em preview image from `og-image.png`. To make each challenge link show *that player's* card and score in iMessage, group chats and X, run the small Cloudflare Worker in `worker/` (free plan is plenty). It only handles `/c/*` links; the rest of the site is served by GitHub Pages as usual.
1. Put your domain on Cloudflare, pointing at GitHub Pages as in the custom domain step. Once GitHub shows HTTPS working, switch the DNS records to **Proxied** (orange) and set **SSL/TLS → Full (strict)**.
2. Deploy `worker/share-worker.js` (`cd worker && npx wrangler deploy` with `wrangler.toml` filled in, or paste it in the dashboard) with vars `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and the route `yourdomain.com/c/*`.
3. GitHub Variables: add `SHARE_BASE` = `https://yourdomain.com` and rerun the site deploy. Challenge links become `yourdomain.com/c/<id>`; the worker serves the preview, then sends people into the challenge.

Finished games upload their share card to the public `cards` storage bucket automatically; that's what the preview shows.

---

## Rebuilding the player data
`supabase/functions/game/rolls.json` comes from nflverse weekly stats (regular season, full PPR). Download `stats_player_week_YYYY.csv` for 1999–2025 from the nflverse-data `stats_player` release into `data_raw/`, then:
```
python3 scripts/build_data.py data_raw supabase/functions/game/rolls.json
```
The script also repairs 2001–02 weeks where nflverse tagged a player with the opponent's team.

## How cheating is kept out
- Points, tiers and finishes never reach the browser until a pick is locked. The edge function owns the game state.
- Players are listed alphabetically, so list order can't leak who scored most.
- One Daily per account (enforced by a database constraint), and Ranked games can't be restarted.
- Accounts need a Google login or a verified email.
