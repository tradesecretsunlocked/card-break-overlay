(() => {
  // ---- Defaults (set once via chrome.storage, see notes below)
  const DEFAULTS = {
    bridgeUrl: "https://tsu-bridge-thc.onrender.com",
    bridgeKey: ""
  };

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function cleanUrl(u) {
    return String(u || "").trim().replace(/\/$/, "");
  }

  function getLiveIdFromUrl() {
    // Works for common Whatnot patterns like /live/<id> or any URL containing a UUID-ish id
    const href = location.href;

    const liveMatch = href.match(/\/live\/([a-z0-9-]+)/i);
    if (liveMatch?.[1]) return liveMatch[1];

    const uuidMatch = href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch?.[0]) return uuidMatch[0];

    return null;
  }

  function injectInjectedJs() {
    const src = chrome.runtime.getURL("injected.js");
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function postToInjected(type, requestId, liveId, after) {
    window.postMessage({ type, requestId, liveId, after }, "*");
  }

  function requestInjected(type, { liveId, after } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        reject(new Error(`Injected request timeout: ${type}`));
      }, 8000);

      function onMsg(event) {
        if (event.source !== window) return;
        const msg = event.data || {};
        if (msg.requestId !== requestId) return;

        if (msg.type === `${type}_RESULT`) {
          clearTimeout(timeout);
          window.removeEventListener("message", onMsg);

          if (msg.success) resolve(msg.data);
          else reject(new Error(msg.error || "Injected error"));
        }
      }

      window.addEventListener("message", onMsg);
      postToInjected(type, requestId, liveId, after);
    });
  }

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (cfg) => {
      // Console/onboarding overrides (page localStorage)
      // In DevTools console on whatnot.com you can run:
      // localStorage.setItem("tsu.bridgeUrl", "https://tsu-bridge-wcb.onrender.com");
      // localStorage.setItem("tsu.bridgeKey", "532fd76b0adda10c094e07f531fea15d");

      let bridgeUrl = cleanUrl(cfg.bridgeUrl);
      let bridgeKey = String(cfg.bridgeKey || "").trim();

      try {
        const lsUrl = cleanUrl(localStorage.getItem("tsu.bridgeUrl"));
        const lsKey = String(localStorage.getItem("tsu.bridgeKey") || "").trim();

        if (lsUrl) bridgeUrl = lsUrl;
        if (lsKey) bridgeKey = lsKey;
      } catch (_) {}

      resolve({ bridgeUrl, bridgeKey });
    });
  });
}


async function sendEvent(cfg, payload) {
  if (!cfg.bridgeUrl) return;

  const url = `${cfg.bridgeUrl}/events`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-key": cfg.bridgeKey
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn("[TSU] POST /events failed:", r.status, txt);
    } else {
      console.log("[TSU] POST /events ok:", payload);
    }
  } catch (e) {
    console.warn("[TSU] POST /events error:", e?.message || e);
  }
}


  // ---- Main
  injectInjectedJs();

  let injectedReady = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "WHATNOT_SPY_INJECTED_READY") {
      injectedReady = true;
      console.log("[TSU] injected.js ready");
    }
  });

  (async () => {
    // Wait for injected to announce readiness
    for (let i = 0; i < 40 && !injectedReady; i++) await sleep(250);
    if (!injectedReady) {
      console.warn("[TSU] injected.js never became ready.");
      return;
    }

    const liveId = getLiveIdFromUrl();
    if (!liveId) {
      console.warn("[TSU] No liveId found in URL.");
      return;
    }

    const cfg = await getConfig();
    if (!cfg.bridgeUrl) {
      console.warn("[TSU] Missing bridgeUrl in storage.");
      return;
    }

    console.log("[TSU] liveId:", liveId);
    console.log("[TSU] bridge:", cfg.bridgeUrl);

    // Dedupe set for sold item ids
    const seen = new Set();

    // Buyer stats (count-based top buyer)
    const buyerCounts = new Map();
    let lastSaleText = "—";

    while (true) {
      try {
        // Fetch sold items (latest page)
        const sold = await requestInjected("WHATNOT_SPY_FETCH_SOLD_ITEMS", { liveId, after: null });

        const edges = sold?.edges || [];
        // edges likely newest-first, but not guaranteed. We'll process oldest->newest for sane “last sale”
        const nodes = edges
          .map((e) => e?.node)
          .filter(Boolean)
          .reverse();

        for (const n of nodes) {
          const id = n.id || n._id || n.createdAt || JSON.stringify(n);
          if (seen.has(id)) continue;
          seen.add(id);

          const buyer =
            n?.buyer?.username ||
            n?.buyer?.name ||
            n?.buyer?.displayName ||
            "Unknown";

          // price fields vary: sometimes cents, sometimes amount object.
          let amount = 0;
          const raw =
            n?.price?.amount ||
            n?.price?.value ||
            n?.price ||
            n?.finalPrice?.amount ||
            n?.finalPrice;

          if (typeof raw === "number") amount = raw;
          if (typeof raw === "string") amount = Number(raw) || 0;

          // Heuristic: if this is cents, normalize (common in APIs)
          if (amount > 0 && amount >= 1000 && Number.isInteger(amount)) {
            // Only do this if it looks like cents. (10.00 = 1000)
            amount = amount / 100;
          }

        const title =
  n?.listing?.title ||
  n?.listing?.description ||
  n?.title ||
  n?.product?.title ||
  "Sale";


          lastSaleText = `${buyer} • ${title} • $${amount.toFixed(2)}`;

          buyerCounts.set(buyer, (buyerCounts.get(buyer) || 0) + 1);

          // Send a NEW SALE event (overlay uses this to update high bid per break)
        const eventPayload = {
        type: "team_sold",
         buyer,
         amount,
         title,
  
           // optional extras for debugging / future matching
            listingId: n?.listing?.id || null,
           productId: n?.product?.id || null
          };

console.log("[TSU] sending event:", eventPayload);
await sendEvent(cfg, eventPayload);

        }

        // Send summary stats occasionally (doesn't include “highBid snapshot” so it won’t break resets)
        let topBuyer = "—";
        let topBuyerCount = 0;
        for (const [b, c] of buyerCounts.entries()) {
          if (c > topBuyerCount) {
            topBuyerCount = c;
            topBuyer = b;
          }
        }

        await sendEvent(cfg, {
          type: "stream_stats",
          topBuyer,
          lastSale: lastSaleText
        });

        // Poll cadence
        await sleep(3000);
      } catch (err) {
        console.warn("[TSU] poll error:", err?.message || err);
        await sleep(5000);
      }
    }
  })();
})();
