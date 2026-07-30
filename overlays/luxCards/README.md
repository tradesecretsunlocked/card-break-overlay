## LuxCards Overlay

This folder hosts the LuxCards–branded version of the break overlay. It reuses the same functionality as the main overlay while swapping in LuxCards colors, logo, and default SSE bridge.

### Usage

1. Serve the project root (e.g. `npx serve . -l 5000`).
2. Load `http://localhost:5000/luxCards/index.html` (or deploy the file to GitHub Pages/OBS). The bridge is `https://bridge.tradesecretsunlocked.com` for every client and the client's bridge key is baked into the overlay file, so no `?bridge=` or `?key=` parameter is used. Those parameters are debug overrides only.
3. Ensure `extension/content.js` is packaged with the `luxCards` entry, and that its `DEFAULTS.bridgeKey` and `DEFAULTS.overlayId` match the values baked into the overlay.

### Assets

Place the LuxCards logo at `images/logos/luxcards.png`. The header image hides itself automatically if the file is missing.
