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
