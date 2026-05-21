# NRE Call Activity Dashboard

A live executive dashboard for New Reach Education's sales call activity.
Reads call data from Supabase (synced from Close every 15 minutes) and shows
team dials, talk time, connect rate (60s+), per-rep leaderboards, time-of-day
patterns, and a 7-day rollup. Auto-refreshes every 2 minutes.

## What's already configured
- Supabase project URL and publishable key are set in `src/App.jsx`.
- The dashboard reads from the `call_activity` table (read-only).

## Deploy to Netlify (via GitHub)

1. Create a new repository on GitHub (e.g. `nre-call-dashboard`).
2. Upload all the files in this folder to that repo
   (drag them into GitHub's "upload files", or use git).
3. In Netlify: **Add new site → Import an existing project → GitHub**,
   pick the repo.
4. Netlify auto-detects the settings from `netlify.toml`
   (build command `npm run build`, publish directory `dist`). Just click Deploy.
5. When it finishes, you get a live URL. That's your dashboard.

## Run locally (optional)
```
npm install
npm run dev
```
Then open the printed localhost URL.

## Changing settings
- Refresh interval and history length: top of `src/App.jsx`
  (`REFRESH_MS`, `LOOKBACK_DAYS`).
- Connect threshold lives in the sync function, not here (it's >60s).
