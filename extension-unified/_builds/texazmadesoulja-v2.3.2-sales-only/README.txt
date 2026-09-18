TexazMadeSoulja — TSU sales extension
=====================================
Version : 2.3.2 (sales only — NO chatbot; no background.js / bot-content.js)
Built   : 2026-09-05
Filed   : 2026-09-15 (this was the ONLY copy and it existed only as a loose zip
          in a temporary uploads folder — no copy was in the repo or anywhere
          else on disk. Filed here so it cannot be lost.)

BAKED CONFIG (verified 2026-09-15 against the live overlay + Supabase):
  bridgeKey      792f3165-9f71-4c17-bdb6-1c6f69218d46   (active in bridge_keys)
  sellerUsername texazmadesoulja                        (verified live on Whatnot)
  overlayId      texazmadesoulja-overlay                (matches overlay OVERLAY_ID)
  sport          nil        -> multi-sport, infer from listing title
  sendUnresolved false      -> correct: this is a TEAM-CODE board, not named spots
  channel        main

Overlay: overlays/texazmadesoulja/index.html
  live at https://tradesecretsunlocked.github.io/card-break-overlay/overlays/texazmadesoulja/index.html

INSTALL (client machine):
  1. chrome://extensions
  2. Developer mode ON
  3. Load unpacked -> select THIS folder
  4. Load the overlay URL above as an OBS Browser Source
  5. Smoke test: start any show, confirm the overlay's SSE badge goes green.
     As of 2026-09-15 this key had received ZERO bridge_events — the path has
     never carried a real sale. Test before a live break, not during one.

KNOWN CONSIDERATION:
  The seller ownership gate fails CLOSED. Capture only runs when the show host
  is exactly "texazmadesoulja". He co-hosts shows with Atlantic Collectibles
  (a separate TSU client, key 2fcd3c44-...). Any show run from AC's account
  captures nothing on this board. Fix would be a comma-separated allowlist in
  DEFAULTS.sellerUsername — do NOT add one without deciding whose board the
  co-hosted sales belong to.
