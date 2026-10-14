# Deploy Court Notes on Render

This preserves the app's username/password accounts and SQLite storage. Render requires paid compute for persistent disks. Review the current price in the Render dashboard before creating the service. Configuration follows the [Render Blueprint reference](https://render.com/docs/blueprint-spec) and [persistent disk documentation](https://render.com/docs/disks).

## Before deployment

1. Export your local journal from the app's menu if you have logged games. The hosted app starts with a new database; local accounts do not transfer automatically.
2. Create a **private GitHub repository** and upload this project's source files, including `render.yaml` and the PNG icons. Never upload `data/`, SQLite database files, passwords, or environment secrets. The `.gitignore` excludes the database.
3. Connect Render to GitHub with access to that repository. Connecting the Render integration here also allows deployment assistance from this chat.

## Create the service

1. In the [Render dashboard](https://dashboard.render.com/), choose **New → Blueprint** and select the repository.
2. Use the repository's `render.yaml`. It defines one Node web service, a 1 GB persistent disk mounted at `/var/lib/court-notes`, and `/healthz` for health checks.
3. Review the paid service and disk costs before deploying.
4. Wait for the deployment to become live. Render provides an HTTPS address such as `https://court-notes-xxxx.onrender.com`.
5. Open the address, create your account, and log in. If needed, restore the JSON backup through the menu.

The app uses Render's `RENDER_EXTERNAL_URL` as its allowed origin automatically. If you add a custom domain, set `APP_ORIGIN` to that exact HTTPS origin with no trailing slash; then use that domain consistently. See [Render's default environment variables](https://render.com/docs/environment-variables).

## Check before installing

- Visit `/healthz` on the deployed address: it should show `{"ok":true}`.
- Create a session in your computer browser.
- Log into the **same account at the same address** in Safari on your iPhone and verify the session appears.
- Log a game on your phone and check it on the computer. Changes refresh when the app regains focus or within 15 seconds when visible and no form is open.
- Keep the app to one server instance with its persistent disk. Back up journals regularly using the export option.

## Install on iPhone

1. Open the deployed HTTPS address in **Safari** on your iPhone.
2. Tap **Share** and choose **Add to Home Screen**.
3. If offered, leave **Open as Web App** enabled, then tap **Add**.
4. Launch **Court Notes** from the home-screen icon and log in if prompted.

This is an installed web app with its own window and icon. An internet connection is required to load and save your account journal. No App Store submission or developer membership is needed.

Keep the database disk when redeploying. Do not delete the service or disk without a backup. Password recovery is not implemented yet, so save your account password in a password manager.
