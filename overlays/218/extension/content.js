(() => {
  /**
   * TSU Standard content.js — 218 Cards & Co.
   * Bridge URL: enter your Render bridge URL below OR set via
   *   chrome.storage or localStorage override (tsu.bridgeUrl)
   */

  // =========================
  // 1) Per-client defaults
  // =========================
  const DEFAULTS = {
    // ✅ SET YOUR BRIDGE URL HERE:
    bridgeUrl: "",   // e.g. "https://tsu-bridge-218cards.onrender.com"

    bridgeKey: "",

    // NFL-only overlay
    sport: "nfl",

    overlayId: "218-cards",
    channel: "main",
    pollMs: 3000,
    summaryEvery: 5
  };

  // =========================
  // 2) Tiny utils
  // =========================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const cleanUrl = (u) => String(u || "").trim().replace(/\/$/, "");

  const cleanSport = (s) => {
    const v = String(s || "").trim().toLowerCase();
    if (!v) return "";
    return ["nfl", "nba", "mlb", "nil"].includes(v) ? v : "";
  };

  const clampInt = (n, d, min, max) => {
    const v = parseInt(n, 10);
    if (!Number.isFinite(v)) return d;
    return Math.max(min, Math.min(max, v));
  };

  // Prefer explicit 2–4 char tokens like BUF, NYJ, LAL
  function inferCodeFromTitle(title, sport) {
    const t = String(title || "");
    const m = t.match(/\b([A-Z]{2,4})\b/);
    if (m && m[1]) return m[1];

    // Minimal NFL fallback (overlay itself should have full lookup)
    const s = t.toLowerCase();
    const NFL = [
      ["jaguars", "JAX"], ["jets", "NYJ"], ["giants", "NYG"], ["cowboys", "DAL"],
      ["49ers", "SF"], ["packers", "GB"], ["patriots", "NE"], ["raiders", "LV"],
      ["chargers", "LAC"], ["rams", "LAR"], ["buccaneers", "TB"],
    ];

    if (sport === "nfl") {
      for (const [k, code] of NFL) if (s.includes(k)) return code;
    }
    return "";
  }

  function stripPrefixTitle(title) {
    const raw = String(title || "").trim();
    if (!raw) return "";
    const parts = raw.split(" - ").map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : raw;
  }

  function isBadTitle(t) {
    const raw = String(t || "").trim();
    if (!raw) return true;
    const s = raw.toLowerCase();
    if (s === "sale" || s === "—") return true;
    const tail = stripPrefixTitle(raw);
    if (!tail || tail.toLowerCase() === "sale") return true;
    return false;
  }

  function parsePrice(node) {
    const p =
      node?.price ||
      node?.finalPrice ||
      node?.listing?.price ||
      node?.listing?.finalPrice ||
      null;

    let cents = null;
    let currency = "USD";

    if (p && typeof p === "object") {
      if (typeof p.currency === "string") currency = p.currency;
      if (typeof p.amount === "number") cents = p.amount;
      if (typeof p.value === "number") cents = p.value;
    } else if (typeof p === "number") {
      cents = p;
    } else if (typeof p === "string" && p.trim()) {
      const num = Number(p);
      if (Number.isFinite(num)) cents = num;
    }

    let amount = 0;
    if (typeof cents === "number" && Number.isFinite(cents)) {
      amount = Number.isInteger(cents) ? cents / 100 : cents;
    }

    return { amount, currency, cents };
  }

  // =========================
  // 3) Whatnot Live ID
  // =========================
  function getLiveIdFromUrl() {
    const href = location.href;
    const liveMatch = href.match(/\/live\/([a-z0-9-]+)/i);
    if (liveMatch?.[1]) return liveMatch[1];
    const uuidMatch = href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch?.[0]) return uuidMatch[0];
    return null;
  }

  // =========================
  // 4) injected.js bridge
  // =========================
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

  // =========================
  // 5) Config resolution
  // =========================
  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULTS, (cfg) => {
        let bridgeUrl = cleanUrl(cfg.bridgeUrl);
        let bridgeKey = String(cfg.bridgeKey || "").trim();
        let sport = cleanSport(cfg.sport) || "nfl";
        let overlayId = String(cfg.overlayId || "218-cards").trim();
        let channel = String(cfg.channel || "main").trim().toLowerCase() || "main";
        let pollMs = clampInt(cfg.pollMs, DEFAULTS.pollMs, 1000, 20000);
        let summaryEvery = clampInt(cfg.summaryEvery, DEFAULTS.summaryEvery, 1, 50);

        // Local overrides (DevTools on whatnot.com)
        try {
          const lsUrl = cleanUrl(localStorage.getItem("tsu.bridgeUrl"));
          const lsKey = String(localStorage.getItem("tsu.bridgeKey") || "").trim();
          const lsSport = cleanSport(localStorage.getItem("tsu.sport"));
          const lsOverlayId = String(localStorage.getItem("tsu.overlayId") || "").trim();
          const lsChannel = String(localStorage.getItem("tsu.channel") || "").trim().toLowerCase();
          const lsPollMs = localStorage.getItem("tsu.pollMs");
          const lsSummaryEvery = localStorage.getItem("tsu.summaryEvery");

          if (lsUrl) bridgeUrl = lsUrl;
          if (lsKey) bridgeKey = lsKey;
          if (lsSport) sport = lsSport;
          if (lsOverlayId) overlayId = lsOverlayId;
          if (lsChannel) channel = lsChannel;
          if (lsPollMs) pollMs = clampInt(lsPollMs, pollMs, 1000, 20000);
          if (lsSummaryEvery) summaryEvery = clampInt(lsSummaryEvery, summaryEvery, 1, 50);
        } catch (_) {}

        resolve({ bridgeUrl, bridgeKey, sport, overlayId, channel, pollMs, summaryEvery });
      });
    });
  }

  // =========================
  // 6) Bridge POST
  // =========================
  async function sendEvent(cfg, payload) {
    if (!cfg.bridgeUrl) return;

    const url = `${cfg.bridgeUrl}/events`;
    const body = {
      ts: Date.now(),
      channel: cfg.channel || "main",
      overlay_id: cfg.overlayId || undefined,
      ...payload
    };

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-key": cfg.bridgeKey,
          "x-api-key": cfg.bridgeKey
        },
        body: JSON.stringify(body)
      });

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        console.warn("[TSU 218] POST /events failed:", r.status, txt);
      } else {
        console.log("[TSU 218] POST /events ok:", body.type, body);
      }
    } catch (e) {
      console.warn("[TSU 218] POST /events error:", e?.message || e);
    }
  }

  // =========================
  // 7) Main loop
  // =========================
  injectInjectedJs();

  let injectedReady = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "WHATNOT_SPY_INJECTED_READY") {
      injectedReady = true;
      console.log("[TSU 218] injected.js ready");
    }
  });

  (async () => {
    // Wait for injected.js
    for (let i = 0; i < 40 && !injectedReady; i++) await sleep(250);
    if (!injectedReady) {
      console.warn("[TSU 218] injected.js never became ready.");
      return;
    }

    const liveId = getLiveIdFromUrl();
    if (!liveId) {
      console.warn("[TSU 218] No liveId found in URL.");
      return;
    }

    const cfg = await getConfig();
    if (!cfg.bridgeUrl) {
      console.warn("[TSU 218] Missing bridgeUrl — set it in the BRIDGE popup on the overlay or via chrome.storage.");
      return;
    }

    console.log("[TSU 218] liveId:", liveId);
    console.log("[TSU 218] bridge:", cfg.bridgeUrl);
    console.log("[TSU 218] sport:", cfg.sport, "| overlay_id:", cfg.overlayId, "| channel:", cfg.channel);

    // Warmup ping (keeps Render awake)
    await sendEvent(cfg, {
      type: "overlay_warmup",
      liveId,
      sport: cfg.sport
    });

    const seen = new Map();
    const lastCodeByListing = new Map();
    const buyerCounts = new Map();
    let lastSaleText = "—";
    let loops = 0;

    while (true) {
      try {
        const sold = await requestInjected("WHATNOT_SPY_FETCH_SOLD_ITEMS", { liveId, after: null });

        const edges = sold?.edges || [];
        const nodes = edges.map((e) => e?.node).filter(Boolean).reverse();

        for (const n of nodes) {
          const id = n?.id || n?._id || n?.createdAt || JSON.stringify(n);

          const buyer =
            n?.buyer?.username ||
            n?.buyer?.name ||
            n?.buyer?.displayName ||
            "Unknown";

          const rawTitle =
            n?.listing?.title ||
            n?.listing?.subtitle ||
            n?.listing?.description ||
            n?.title ||
            n?.product?.title ||
            "Sale";

          const title = stripPrefixTitle(rawTitle);

          const prevTitle = seen.get(id);
          if (prevTitle && prevTitle === title) continue;
          if (isBadTitle(rawTitle) || isBadTitle(title)) continue;

          seen.set(id, title);

          const price = parsePrice(n);
          const amount = price.amount;
          const sport = cfg.sport || "nfl";
          const code = inferCodeFromTitle(title, sport);

          lastSaleText = `${buyer} • ${title} • $${amount.toFixed(2)}`;
          buyerCounts.set(buyer, (buyerCounts.get(buyer) || 0) + 1);

          const eventPayload = {
            type: "team_sold",
            saleId: id,
            buyer,
            title,
            amount,
            amountCents: price.cents,
            currency: price.currency,
            sport,
            code,
            listingId: n?.listing?.id || null,
            productId: n?.listing?.product?.id || n?.product?.id || null,
            liveId
          };

          // Respin detection: if the same listing was previously a different team, unsell the old one
          const listingKey = eventPayload.listingId || eventPayload.productId || id;
          const prevCode = lastCodeByListing.get(listingKey);
          if (prevCode && eventPayload.code && prevCode !== eventPayload.code) {
            await sendEvent(cfg, {
              type: "team_unsold",
              code: prevCode,
              listingId: eventPayload.listingId,
              productId: eventPayload.productId,
              liveId
            });
          }
          if (eventPayload.code) lastCodeByListing.set(listingKey, eventPayload.code);

          console.log("[TSU 218] sending event:", eventPayload);
          await sendEvent(cfg, eventPayload);
        }

        // Periodic summary
        loops++;
        if (loops % cfg.summaryEvery === 0) {
          let topBuyer = "—";
          let topBuyerCount = 0;
          for (const [b, c] of buyerCounts.entries()) {
            if (c > topBuyerCount) { topBuyerCount = c; topBuyer = b; }
          }
          await sendEvent(cfg, {
            type: "stream_stats",
            topBuyer,
            lastSale: lastSaleText,
            liveId
          });
        }

        await sleep(cfg.pollMs);
      } catch (err) {
        console.warn("[TSU 218] poll error:", err?.message || err);
        await sleep(5000);
      }
    }
  })();
})();
