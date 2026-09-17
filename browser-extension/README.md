# Casiva Listing Capture

A small browser extension that captures the listing page you're viewing and drops it straight into Casiva's "Verify via Link" tool — no copy/paste needed.

## Why this exists

Some listing sites (apartments.com, 99acres.com) block every server-side scraper Casiva tries (Tavily, a headless browser, even a paid anti-bot proxy service) because they use enterprise bot-detection tuned to catch exactly that kind of traffic. This extension sidesteps the problem entirely: it reads the page while *you* are viewing it in your own real, logged-in browser, so there's nothing for those sites to block — it's genuine human traffic.

## Install (Load Unpacked)

1. Open `chrome://extensions` (or `edge://extensions` in Edge).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder (`browser-extension/`, inside the repo at `d:\Real Estate\real-estate-ai`).
5. Confirm the "Casiva Listing Capture" icon appears in your toolbar. If it's hidden, click the puzzle-piece icon and pin it.

## Usage

1. Make sure the Casiva frontend is running: `npm run dev` in `frontend/` (serves `http://localhost:5173`).
2. Browse to any property listing page in a normal tab.
3. Click the extension's toolbar icon.
4. Watch for a badge on the icon: a green **✓** means the page was captured successfully; a red **!** means it failed (e.g. you clicked on a `chrome://` page, or the page had no visible text).
5. A new tab opens to Casiva's Verify page with "Verify via Link" already selected, and the listing URL + page text pre-filled.
6. Add your own comparison photos and click Compare — same as the manual paste flow today.

## V1 limitations

- Always opens a brand-new tab (doesn't reuse an already-open Casiva tab).
- Hardcoded to `http://localhost:5173`. If your dev server runs on a different port, or you deploy the frontend somewhere else, update **both** `host_permissions` in `manifest.json` and `APP_VERIFY_URL` in `background.js`, then reload the extension from `chrome://extensions`.
- If you're logged out, the new tab will redirect to the login page first — that's fine, the captured data waits in the browser's session storage and still applies once you reach the Verify page.

## Troubleshooting

If clicking the icon doesn't seem to do anything, check the extension's own logs: go to `chrome://extensions`, find "Casiva Listing Capture", and click the **service worker** link to open its console.
