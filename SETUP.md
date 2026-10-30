# Wistia board: automatic sync

1. In each Wistia account: Settings > API Access > create a token with **Read all data** permission only.
2. Create a GitHub repo and upload this whole folder (keep the `.github` and `docs` folders as they are).
3. Repo > Settings > Secrets and variables > Actions > New secret named `WISTIA_ACCOUNTS`:
   [{"label":"Velora","token":"..."},{"label":"AdAstra","token":"..."}]
4. Repo > Settings > Pages > deploy from branch `main`, folder `/docs`.
5. Repo > Actions > "Sync Wistia videos" > Run workflow (it then repeats every 30 minutes).
6. Open https://YOUR-NAME.github.io/REPO/ . The board loads and syncs by itself.

Opening the board from your computer instead? Paste
https://YOUR-NAME.github.io/REPO/wistia-board.json into the "Auto-sync feed URL" box once.

Run it by hand: copy accounts.example.json to accounts.json, add tokens, run `node sync.mjs`.

## Updating an existing repo
Unzip over your folder, then in PowerShell inside it:
  git add -A
  git commit -m "Accounts page, sorting, customize"
  git push
Then run the "Sync Wistia videos" workflow once from the Actions tab.

## Live updates (about 1 minute) - Netlify setup, one time
The board asks a small Netlify function (`netlify/functions/videos.mjs`) for the video list every minute, so a video you add,
delete or rename in Wistia shows up here almost immediately. The function needs your tokens, and they live only in Netlify:
1. Netlify > your site > Site configuration > Environment variables > Add a variable.
2. Key `WISTIA_ACCOUNTS`, value the same JSON you put in the GitHub secret:
   [{"label":"velora1211","token":"..."},{"label":"crew82263","token":"..."},{"label":"zevora.work","token":"..."}]
   (leave the scopes on "All" so Functions can read it; keep the labels identical to the ones in the GitHub secret).
3. Push these files to GitHub (Netlify redeploys by itself), or Deploys > Trigger deploy.
4. Open `https://YOUR-SITE.netlify.app/.netlify/functions/videos` once: you should see JSON with your videos. If you see
   `{"error": ...}` the message says what is wrong (missing variable, bad token...).
The token is never put in the web page. Without the function (GitHub Pages, a local file) the board still works from the GitHub feed alone, as before.

## Bandwidth and storage meters (Accounts page)
Each account card shows monthly bandwidth and storage used vs the plan limit, plus the reset date, straight from Wistia (`/modern/account_usage`).
- The live function refreshes it every minute; the GitHub Action also saves it into `docs/wistia-accounts.json` as a fallback.
- It needs a token created by the account **owner or manager** (otherwise Wistia returns no limits and the card just shows no meter).
- When Wistia gives a reset date it replaces the date typed on the Accounts page; without one, the typed date is used as before.

## How the board gets its videos (important)
Two sources are merged:
- **Live (Netlify function):** decides which videos exist and what they are called. Add / delete / rename in Wistia -> on the board within about a minute.
  A deleted-and-re-uploaded video has a new Wistia ID (the 10 characters in its link), so the old card disappears and the new one appears. The ID is the only thing used to tell videos apart.
- **Feed (GitHub Action -> `docs/wistia-board.json`):** plays, loads, hours watched and the bandwidth-limit flag. Rebuilt every 30 minutes (GitHub sometimes runs it late),
  re-read by the board every 5 minutes. A brand-new video shows its numbers once the feed has caught up.
If the live function is missing or down, the board uses the feed alone (the old behaviour). If Wistia cannot answer for one account, that account keeps its last known videos for that round.

Old notes about the feed, still true:
The board holds **no video list of its own**. Every video comes from the Wistia API through `sync.mjs` -> `docs/wistia-board.json`,
and each sync makes the board an exact mirror of that file:
- a video you add in Wistia appears on the next sync;
- a video you delete (or rename) in Wistia is removed (or renamed) on the next sync;
- the old built-in list and everything older versions saved in the browser are gone (wiped automatically on first open).
So the number on each account is the number Wistia's API returns for that account. The Accounts page also shows
"Wistia's own counter" when Wistia's account counter differs from the list (it leaves out the built-in "Lumber Party" sample video).
To remove a video, delete it in Wistia. The board no longer has its own Remove / Rename / Add / Import buttons.
If one account's token fails, `sync.mjs` keeps that account's last known videos instead of dropping them, and exits with an error so you see it.

## Downloading videos (also the ones that hit the bandwidth limit)
- The download button on a card saves the video under its exact name. Tick the circle on several cards (or press **Select all**) and use
  **Download ZIP** (one file, every video keeps its exact name) or **Download files** (separate files). Cancel stops a running download.
- When an account used up its monthly bandwidth, Wistia's embed lists no files for its videos. For those the board asks the small Netlify function
  `netlify/functions/download.mjs`, which reads the link from the Wistia API with the account token (same `WISTIA_ACCOUNTS` variable, nothing new to set up).
  It needs the Netlify site (not GitHub Pages). Wistia may still refuse to serve the file while the account is over its limit; the board then says so.
- In Chrome / Edge the ZIP is written straight to the file you pick, so big videos do not fill the memory. Other browsers build it in memory.
- Auto-preview is off by default.

## Good to know
- **Delay:** with the live function, a change in Wistia shows within about a minute (press Sync for an instant check). Without it, a change shows after the next feed rebuild (every 30 minutes) plus the board's own check (every 10 minutes).
- **Netlify usage:** the board asks the function once a minute while a tab is open and visible (hidden tabs pause). That is well inside Netlify's free allowance for normal use.
- **Updating the repo:** unzip over your folder, keep the hidden `.github` folder, and do NOT overwrite `docs/wistia-board.json` / `docs/wistia-accounts.json` with older copies (the Action writes those).
- **Remove on the Accounts page** only removes that account's reset-date card (it stays removed). Add it again with "Add account" if you want it back.
- **Private / locked-down browsers** that block storage still work; they just forget your sort, filters and reset dates between visits.
- **Same account name twice** in the sync settings is refused with a clear message; an account with no label is called account1, account2...
