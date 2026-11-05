# Wistia board on Cloudflare Pages

## Why you saw 404
Cloudflare was serving the repo root, but the page is `docs/index.html`. This version ships a `wrangler.toml`
with `pages_build_output_dir = "./docs"`, so Pages serves the `docs` folder and `/` works.
(If your project ignores that file, set it by hand: Pages project > Settings > Builds > **Build output directory = `docs`**,
build command empty.)

## Update your repo
1. Unzip over your repo folder (keep the hidden `.github` folder).
2. Delete the old `netlify/` folder and `netlify.toml` (no longer used).
3. Do NOT touch `docs/wistia-board.json` / `docs/wistia-accounts.json` (the GitHub Action writes them; they are not in this zip).
4. `git add -A && git commit -m "Cloudflare Pages version" && git push`
   Cloudflare redeploys by itself.

## Live updates (about 1 minute): one-time secret
1. Cloudflare > Workers & Pages > `wistia-tracker` > Settings > Variables and Secrets > Add.
2. Type **Secret**, name `WISTIA_ACCOUNTS`, value the same JSON as the GitHub secret:
   `[{"label":"velora1211","token":"..."},{"label":"crew82263","token":"..."}]`
   Add it for **Production** (and Preview if you use it).
3. Redeploy once (Deployments > latest > Retry deployment) so the function sees the secret.
4. Open `https://wistia-tracker.pages.dev/api/videos`. You should see JSON with your videos.
   `{"error": ...}` means the message says what is wrong (missing secret, bad token...).

Without the secret the board still works from the GitHub feed alone.

## What changed from the Netlify version
- `netlify/functions/*.mjs` became `functions/api/videos.js` and `functions/api/download.js`
  (addresses `/api/videos` and `/api/download`; `docs/index.html` already points to them).
- `functions/_lib/wistia.js` is the Workers-safe copy of `wistia-lib.mjs` (the Action still uses the original).
- The sync commit message now contains `[skip ci]`, so the 30-minute data commits do not start a Cloudflare build
  (the board reads the feed from GitHub, not from the deployed copy).

The rest (GitHub Action, `WISTIA_ACCOUNTS` GitHub secret, bandwidth meters, downloads) works as described in the old notes.
