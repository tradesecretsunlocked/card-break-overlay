## LuxCards Overlay

This folder hosts the LuxCards–branded version of the break overlay. It reuses the same functionality as the main overlay while swapping in LuxCards colors, logo, and default SSE bridge.

### Usage

1. Serve the project root (e.g. `npx serve . -l 5000`).
2. Load `http://localhost:5000/luxCards/index.html?bridge=https://tsu-bridge-luxcards.onrender.com` (or deploy the file to GitHub Pages/OBS).
3. Ensure `extension/content.js` is packaged with the `luxCards` entry and the matching `BRIDGE_KEY`.

### Assets

Place the LuxCards logo at `images/logos/luxcards.png`. The header image hides itself automatically if the file is missing.
