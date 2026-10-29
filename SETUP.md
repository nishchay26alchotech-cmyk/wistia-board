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

## How the board gets its videos (important)
The board holds **no video list of its own**. Every video comes from the Wistia API through `sync.mjs` -> `docs/wistia-board.json`,
and each sync makes the board an exact mirror of that file:
- a video you add in Wistia appears on the next sync;
- a video you delete (or rename) in Wistia is removed (or renamed) on the next sync;
- the old built-in list and everything older versions saved in the browser are gone (wiped automatically on first open).
So the number on each account is the number Wistia's API returns for that account. The Accounts page also shows
"Wistia's own counter" when Wistia's account counter differs from the list (it leaves out the built-in "Lumber Party" sample video).
To remove a video, delete it in Wistia. The board no longer has its own Remove / Rename / Add / Import buttons.
If one account's token fails, `sync.mjs` keeps that account's last known videos instead of dropping them, and exits with an error so you see it.

## Good to know
- **Delay:** a change in Wistia shows on the board after the next feed rebuild (every 30 minutes) plus the board's own check (every 10 minutes,
  and straight away when you come back to a tab that was asleep). For an instant update run the "Sync Wistia videos" workflow, then press Sync on the board.
- **Remove on the Accounts page** only removes that account's reset-date card (it stays removed). Add it again with "Add account" if you want it back.
- **Private / locked-down browsers** that block storage still work; they just forget your sort, filters and reset dates between visits.
- **Same account name twice** in the sync settings is refused with a clear message; an account with no label is called account1, account2...
