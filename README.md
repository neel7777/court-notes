# Court Notes

A phone-first pickleball journal with accounts and private server-saved journals. Log in at the **same website address** on your phone and computer to access the same games.

## Run locally

Requires **Node.js 22.13 or newer** (tested with 22.14). No dependencies or build step needed. Node 22 may print an experimental SQLite warning.

```sh
npm start
```

Chrome opens at http://localhost:5173. Stop the server with Ctrl+C before restarting. Set `PORT` for another port, or `OPEN_BROWSER=0` to skip opening Chrome. In PowerShell:

```powershell
$env:OPEN_BROWSER = "0"
npm start
```

Choose **Create an account**, enter a username and a nonempty password. There are no password length requirements. Usernames are case-insensitive. Password recovery and email verification are not implemented; use a password manager.

## Data and sync

- Accounts and journals live in `data/court-notes.sqlite`, excluded from Git and inaccessible through the static file server.
- Data persists across browser and server restarts. Deleting the database or losing the server disk removes accounts and data.
- Each account has a private journal. Login sessions last up to 30 days; logout revokes the current session.
- Saves wait for server confirmation. Other devices refresh every 15 seconds while the app is visible, and when the window gains focus. Open forms are not refreshed underneath you.
- A save from an older journal is rejected if another device has saved changes. Editing pauses: export the visible changes from the menu, reload, and reconcile against the latest journal. Competing edits are not silently merged.
- Internet is required to load and save journals. The app shell can load offline; offline editing and private journal caching are not implemented.
- Export backups from the menu. Restoring a backup replaces the current account's journal after confirmation.

If this browser still has games from the original local-only version, logging into an empty account offers to import them. The original local copy is retained. You can also export from the old browser and restore into your account. Local storage is specific to a browser and website address.

## Hosting and phone installation

For the prepared Render setup and iPhone installation steps, see [DEPLOY.md](DEPLOY.md). The included `render.yaml` defines the server and persistent database disk. On Render, the app automatically uses `RENDER_EXTERNAL_URL` when `APP_ORIGIN` is unset.

This version needs a **Node server and persistent disk**. Static hosting such as GitHub Pages alone no longer works. Use a host that runs Node 22.13+ with a durable mounted directory, or a VPS. Run one server against one SQLite database; avoid ephemeral storage and multiple server replicas.

Configure these environment variables on the host:

```text
NODE_ENV=production
APP_ORIGIN=https://your-app.example.com
DATA_DIR=/var/lib/court-notes
OPEN_BROWSER=0
PORT=5173
```

`APP_ORIGIN` is the exact public origin, without a trailing slash or path. Set `DATA_DIR` to your persistent mounted directory; the app creates `data/court-notes.sqlite` inside it. Use the port required by your host. Run `npm start`. Terminate HTTPS at the host/reverse proxy and forward requests to the app. Production login cookies require HTTPS.

Keep the database directory private and back it up. Stop the server before copying the database and its WAL files, or use SQLite's online backup facilities.

Once hosted, open that **same HTTPS address** on both devices and log into the same account. On iPhone, use Safari's Share menu and Add to Home Screen. On Android, use Chrome's Install app / Add to Home screen menu. Clearing browser data does not delete the server journal; log in again to retrieve it.

For temporary phone preview on the same Wi-Fi, visit `http://<computer-LAN-IP>:5173` while the server runs, if your firewall permits it. HTTP preview is for development: it does not provide encrypted login or full PWA installation.

## Validation

```sh
npm test
npm run check
```

Integration tests verify account isolation, persistence across database reopening, login/logout, origin checks, malformed data rejection, and conflict protection.

Passwords are salted and hashed with scrypt. Sessions use random tokens stored as hashes and HttpOnly, SameSite cookies; production adds Secure. Writes require the same origin. Login and registration have in-process rate and concurrency limits. See [OWASP password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), and [Node SQLite documentation](https://nodejs.org/download/release/v22.14.0/docs/api/sqlite.html).

## Journal features

- Open-play sessions with dates and locations
- Singles/doubles scores, partner/opponent names, manually entered DUPRs
- Notes on what went well, what to improve, and other details
- Reusable player directory
- Game and session editing/deletion
- Win/loss summaries and reflection history
- JSON backup export and validated restore

No official DUPR integration. Player profile changes leave historical game records unchanged.

## Practice rating estimates

Prior games without a recorded personal DUPR use your saved account rating for their displayed estimates. These are labeled “Using your saved DUPR” and update when you change it. Games with a recorded pre-game rating continue using that historical value. All other player ratings must still be present.

Set your DUPR once in the account menu using **Update my DUPR**. It syncs with your account and is used automatically for new games. If you have already entered a rating in a game, it is reused until you set an account rating. Without a saved rating, logging a game prompts you to save it once. Enter the other players' ratings to see a signed per-game estimate and live preview. Missing ratings produce no estimate. Each game keeps a snapshot of your rating; changing your account rating leaves past estimates unchanged. Estimates do not change your official or saved account rating.

This is an illustrative model, not a calibrated prediction of DUPR's proprietary algorithm. For doubles, it averages each team's ratings. Expected point share is `1 / (1 + 10 ** ((opponentRating - teamRating) / 1.5))`. Change is `0.1 * (actualPointShare - expectedPointShare)`, clamped so the resulting rating stays within 2–8. The scale and adjustment factor are app assumptions; they do not incorporate reliability, match history, recency, or result source. Display uses three decimals for rating notation, not a claim of prediction accuracy. See [DUPR's official overview](https://www.dupr.com/how-it-works) for the actual rating system.
