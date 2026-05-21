(() => {
  /**
   * ============================================================
   * TSU STANDARD content.js — Legends Hobby
   * v2.0.0
   * ============================================================
   * overlayId : legends-hobby
   * sport     : nil  (multi-sport — auto-inferred from listing title)
   * bridgeKey : 234aa085-e6e7-41df-a23c-0747899dcc71
   * ============================================================
   */

  const DEFAULTS = {
    bridgeUrl:    "https://bridge.tradesecretsunlocked.com",
    bridgeKey:    "234aa085-e6e7-41df-a23c-0747899dcc71",
    overlayId:    "legends-hobby",
    sport:        "nil",
    channel:      "main",
    pollMs:       3000,
    summaryEvery: 5
  };

  const sleep    = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanUrl = (u) => String(u || "").trim().replace(/\/$/, "").replace(/\/(events|stream)(\/.*)?$/i, "");
  const cleanSport = (s) => { const v = String(s || "").trim().toLowerCase(); return ["nfl","nfl-divisions","nba","mlb","nil"].includes(v) ? v : ""; };
  const clampInt = (n, d, min, max) => { const v = parseInt(n, 10); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d; };

  function stripPrefixTitle(title) {
    const raw = String(title || "").trim();
    if (!raw) return "";
    const parts = raw.split(" - ").map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : raw;
  }

  function isGiveawayLike(title, amount) {
    const s = String(title || "").trim().toLowerCase();
    const n = Number(amount || 0);
    return s.startsWith("giveaway") || s.includes(" giveaway") || s === "sale" || s === "—" || (s.includes("bookmark future shows") && n <= 0);
  }

  const TEAM_TITLE_RULES = [
    { sport:"nfl", code:"ARI", names:["arizona cardinals","cardinals"] },
    { sport:"nfl", code:"ATL", names:["atlanta falcons","falcons"] },
    { sport:"nfl", code:"BAL", names:["baltimore ravens","ravens"] },
    { sport:"nfl", code:"BUF", names:["buffalo bills","bills"] },
    { sport:"nfl", code:"CAR", names:["carolina panthers","panthers"] },
    { sport:"nfl", code:"CHI", names:["chicago bears","bears"] },
    { sport:"nfl", code:"CIN", names:["cincinnati bengals","bengals"] },
    { sport:"nfl", code:"CLE", names:["cleveland browns","browns"] },
    { sport:"nfl", code:"DAL", names:["dallas cowboys","cowboys"] },
    { sport:"nfl", code:"DEN", names:["denver broncos","broncos"] },
    { sport:"nfl", code:"DET", names:["detroit lions","lions"] },
    { sport:"nfl", code:"GB",  names:["green bay packers","packers","green bay"] },
    { sport:"nfl", code:"HOU", names:["houston texans","texans"] },
    { sport:"nfl", code:"IND", names:["indianapolis colts","colts"] },
    { sport:"nfl", code:"JAX", names:["jacksonville jaguars","jaguars","jax jaguars"] },
    { sport:"nfl", code:"KC",  names:["kansas city chiefs","chiefs"] },
    { sport:"nfl", code:"LV",  names:["las vegas raiders","raiders"] },
    { sport:"nfl", code:"LAC", names:["los angeles chargers","la chargers","chargers"] },
    { sport:"nfl", code:"LAR", names:["los angeles rams","la rams","rams"] },
    { sport:"nfl", code:"MIA", names:["miami dolphins","dolphins"] },
    { sport:"nfl", code:"MIN", names:["minnesota vikings","vikings"] },
    { sport:"nfl", code:"NE",  names:["new england patriots","patriots"] },
    { sport:"nfl", code:"NO",  names:["new orleans saints","saints"] },
    { sport:"nfl", code:"NYG", names:["new york giants","ny giants"] },
    { sport:"nfl", code:"NYJ", names:["new york jets","ny jets"] },
    { sport:"nfl", code:"PHI", names:["philadelphia eagles","eagles"] },
    { sport:"nfl", code:"PIT", names:["pittsburgh steelers","steelers"] },
    { sport:"nfl", code:"SF",  names:["san francisco 49ers","49ers","niners"] },
    { sport:"nfl", code:"SEA", names:["seattle seahawks","seahawks"] },
    { sport:"nfl", code:"TB",  names:["tampa bay buccaneers","buccaneers","bucs"] },
    { sport:"nfl", code:"TEN", names:["tennessee titans","titans"] },
    { sport:"nfl", code:"WAS", names:["washington commanders","commanders"] },
    { sport:"nba", code:"ATL", names:["atlanta hawks","hawks"] },
    { sport:"nba", code:"BOS", names:["boston celtics","celtics"] },
    { sport:"nba", code:"BKN", names:["brooklyn nets","nets"] },
    { sport:"nba", code:"CHA", names:["charlotte hornets","hornets"] },
    { sport:"nba", code:"CHI", names:["chicago bulls","bulls"] },
    { sport:"nba", code:"CLE", names:["cleveland cavaliers","cavaliers","cavs"] },
    { sport:"nba", code:"DAL", names:["dallas mavericks","mavericks","mavs"] },
    { sport:"nba", code:"DEN", names:["denver nuggets","nuggets"] },
    { sport:"nba", code:"DET", names:["detroit pistons","pistons"] },
    { sport:"nba", code:"GSW", names:["golden state warriors","warriors"] },
    { sport:"nba", code:"HOU", names:["houston rockets","rockets"] },
    { sport:"nba", code:"IND", names:["indiana pacers","pacers"] },
    { sport:"nba", code:"LAC", names:["la clippers","los angeles clippers","clippers"] },
    { sport:"nba", code:"LAL", names:["la lakers","los angeles lakers","lakers"] },
    { sport:"nba", code:"MEM", names:["memphis grizzlies","grizzlies"] },
    { sport:"nba", code:"MIA", names:["miami heat","heat"] },
    { sport:"nba", code:"MIL", names:["milwaukee bucks","bucks"] },
    { sport:"nba", code:"MIN", names:["minnesota timberwolves","timberwolves","wolves"] },
    { sport:"nba", code:"NOP", names:["new orleans pelicans","pelicans"] },
    { sport:"nba", code:"NYK", names:["new york knicks","knicks"] },
    { sport:"nba", code:"OKC", names:["oklahoma city thunder","thunder"] },
    { sport:"nba", code:"ORL", names:["orlando magic","magic"] },
    { sport:"nba", code:"PHI", names:["philadelphia sixers","philadelphia 76ers","sixers","76ers"] },
    { sport:"nba", code:"PHX", names:["phoenix suns","suns"] },
    { sport:"nba", code:"POR", names:["portland trail blazers","trail blazers","blazers"] },
    { sport:"nba", code:"SAC", names:["sacramento kings","kings"] },
    { sport:"nba", code:"SAS", names:["san antonio spurs","spurs"] },
    { sport:"nba", code:"TOR", names:["toronto raptors","raptors"] },
    { sport:"nba", code:"UTA", names:["utah jazz","jazz"] },
    { sport:"nba", code:"WAS", names:["washington wizards","wizards"] },
    { sport:"mlb", code:"ARI", names:["arizona diamondbacks","diamondbacks","dbacks","d-backs"] },
    { sport:"mlb", code:"ATL", names:["atlanta braves","braves"] },
    { sport:"mlb", code:"BAL", names:["baltimore orioles","orioles"] },
    { sport:"mlb", code:"BOS", names:["boston red sox","red sox"] },
    { sport:"mlb", code:"CHC", names:["chicago cubs","cubs"] },
    { sport:"mlb", code:"CHW", names:["chicago white sox","white sox"] },
    { sport:"mlb", code:"CIN", names:["cincinnati reds","reds"] },
    { sport:"mlb", code:"CLE", names:["cleveland guardians","guardians"] },
    { sport:"mlb", code:"COL", names:["colorado rockies","rockies"] },
    { sport:"mlb", code:"DET", names:["detroit tigers","tigers"] },
    { sport:"mlb", code:"HOU", names:["houston astros","astros"] },
    { sport:"mlb", code:"KC",  names:["kansas city royals","royals"] },
    { sport:"mlb", code:"LAA", names:["los angeles angels","la angels","angels"] },
    { sport:"mlb", code:"LAD", names:["los angeles dodgers","la dodgers","dodgers"] },
    { sport:"mlb", code:"MIA", names:["miami marlins","marlins"] },
    { sport:"mlb", code:"MIL", names:["milwaukee brewers","brewers"] },
    { sport:"mlb", code:"MIN", names:["minnesota twins","twins"] },
    { sport:"mlb", code:"NYM", names:["new york mets","mets"] },
    { sport:"mlb", code:"NYY", names:["new york yankees","yankees"] },
    { sport:"mlb", code:"OAK", names:["oakland athletics","athletics","a's"] },
    { sport:"mlb", code:"PHI", names:["philadelphia phillies","phillies"] },
    { sport:"mlb", code:"PIT", names:["pittsburgh pirates","pirates"] },
    { sport:"mlb", code:"SD",  names:["san diego padres","padres"] },
    { sport:"mlb", code:"SF",  names:["san francisco giants","giants"] },
    { sport:"mlb", code:"SEA", names:["seattle mariners","mariners"] },
    { sport:"mlb", code:"STL", names:["st louis cardinals","st. louis cardinals","cardinals"] },
    { sport:"mlb", code:"TB",  names:["tampa bay rays","rays"] },
    { sport:"mlb", code:"TEX", names:["texas rangers","rangers"] },
    { sport:"mlb", code:"TOR", names:["toronto blue jays","blue jays"] },
    { sport:"mlb", code:"WSH", names:["washington nationals","nationals"] }
  ];

  function normalizeTitleForMatch(title) {
    return String(title || "").toLowerCase().replace(/&/g," and ").replace(/[^\w\s.-]/g," ").replace(/\s+/g," ").trim();
  }

  function inferTeamMatchFromTitle(title) {
    const s = normalizeTitleForMatch(title);
    if (!s) return null;
    const expanded = [];
    for (const rule of TEAM_TITLE_RULES) {
      for (const name of rule.names) expanded.push({ sport: rule.sport, code: rule.code, name: normalizeTitleForMatch(name) });
    }
    expanded.sort((a, b) => b.name.length - a.name.length);
    for (const rule of expanded) { if (s.includes(rule.name)) return { sport: rule.sport, code: rule.code }; }
    return null;
  }

  function inferSportFromTitle(title) { return inferTeamMatchFromTitle(title)?.sport || "nil"; }

  function inferCodeFromTitle(title, sport) {
    const ns = String(sport || "").toLowerCase().trim();
    const match = inferTeamMatchFromTitle(title);
    if (match && (!ns || ns === "nil" || match.sport === ns)) return match.code;
    const m = String(title || "").match(/\b([A-Z]{2,4})\b/);
    if (m?.[1]) {
      const token = m[1].toUpperCase();
      const tm = TEAM_TITLE_RULES.find(r => r.code === token && (!ns || ns === "nil" || r.sport === ns));
      if (tm) return token;
    }
    // Chaser / pack / prize-pack pass-through — overlay resolves via title inference
    // Order matters: check "prize pack" before "pack" to avoid false match.
    const titleLower = String(title || "").toLowerCase();
    if (/\bchaser\b|\bchase\b/.test(titleLower))  return "CHASER";
    if (/\bprize\s*pack\b/.test(titleLower))       return "PRIZEPACK";
    if (/\bpack\b/.test(titleLower))               return "PACK";
    return "";
  }

  function inferCustomCodeFromTitle(title) {
    return String(title || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g,"").slice(0,8) || "";
  }

  function isBadTitle(t) {
    const raw = String(t || "").trim();
    if (!raw) return true;
    const s = raw.toLowerCase();
    if (s === "sale" || s === "—") return true;
    const tail = stripPrefixTitle(raw);
    return !tail || tail.toLowerCase() === "sale";
  }

  function parsePrice(node) {
    const p = node?.price || node?.finalPrice || node?.listing?.price || node?.listing?.finalPrice || null;
    let cents = null, currency = "USD";
    if (p && typeof p === "object") {
      if (typeof p.currency === "string") currency = p.currency;
      if (typeof p.amount  === "number") cents = p.amount;
      if (typeof p.value   === "number") cents = p.value;
    } else if (typeof p === "number") { cents = p; }
    else if (typeof p === "string" && p.trim()) { const num = Number(p); if (Number.isFinite(num)) cents = num; }
    let amount = 0;
    if (typeof cents === "number" && Number.isFinite(cents)) amount = Number.isInteger(cents) ? cents / 100 : cents;
    return { amount, currency, cents };
  }

  function getLiveIdFromUrl() {
    const href = location.href;
    const lm = href.match(/\/live\/([a-z0-9-]+)/i);
    if (lm?.[1]) return lm[1];
    const um = href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return um?.[0] || null;
  }

  function injectInjectedJs() {
    const src = chrome.runtime.getURL("injected.js");
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function postToInjected(type, requestId, liveId, after) { window.postMessage({ type, requestId, liveId, after }, "*"); }

  function requestInjected(type, { liveId, after } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timeout = setTimeout(() => { window.removeEventListener("message", onMsg); reject(new Error(`Injected timeout: ${type}`)); }, 8000);
      function onMsg(event) {
        if (event.source !== window) return;
        const msg = event.data || {};
        if (msg.requestId !== requestId) return;
        if (msg.type === `${type}_RESULT`) {
          clearTimeout(timeout); window.removeEventListener("message", onMsg);
          if (msg.success) resolve(msg.data); else reject(new Error(msg.error || "Injected error"));
        }
      }
      window.addEventListener("message", onMsg);
      postToInjected(type, requestId, liveId, after);
    });
  }

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULTS, (cfg) => {
        let bridgeUrl    = cleanUrl(cfg.bridgeUrl);
        let bridgeKey    = String(cfg.bridgeKey  || "").trim();
        let sport        = cleanSport(cfg.sport);
        let overlayId    = String(cfg.overlayId  || "").trim();
        let channel      = String(cfg.channel    || "main").trim().toLowerCase() || "main";
        let pollMs       = clampInt(cfg.pollMs,       DEFAULTS.pollMs,       1000, 20000);
        let summaryEvery = clampInt(cfg.summaryEvery, DEFAULTS.summaryEvery, 1,    50);
        try {
          // Read both tsu.bridge (canonical) and tsu.bridgeUrl (legacy) to match overlay's own key usage
          const lsUrl = cleanUrl(localStorage.getItem("tsu.bridge") || localStorage.getItem("tsu.bridgeUrl"));
          const lsKey = String(localStorage.getItem("tsu.key") || localStorage.getItem("tsu.bridgeKey") || "").trim();
          const lsSport = cleanSport(localStorage.getItem("tsu.sport"));
          const lsOverlayId = String(localStorage.getItem("tsu.overlayId") || "").trim();
          const lsChannel = String(localStorage.getItem("tsu.channel") || "").trim().toLowerCase();
          if (lsUrl) bridgeUrl = lsUrl;
          if (lsKey) bridgeKey = lsKey;
          if (lsSport) sport = lsSport;
          if (lsOverlayId) overlayId = lsOverlayId;
          if (lsChannel) channel = lsChannel;
        } catch (_) {}
        resolve({ bridgeUrl, bridgeKey, sport, overlayId, channel, pollMs, summaryEvery });
      });
    });
  }

  async function sendEvent(cfg, payload) {
    if (!cfg.bridgeUrl) return;
    const body = { ts: Date.now(), channel: cfg.channel || "main", overlay_id: cfg.overlayId || undefined, ...payload };
    try {
      const r = await fetch(`${cfg.bridgeUrl}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridge-key": cfg.bridgeKey, "x-api-key": cfg.bridgeKey },
        body: JSON.stringify(body)
      });
      if (!r.ok) console.warn("[TSU:legends-hobby] POST failed:", r.status, await r.text().catch(()=>""));
      else console.log("[TSU:legends-hobby] sent:", body.type, body);
    } catch (e) { console.warn("[TSU:legends-hobby] POST error:", e?.message || e); }
  }

  injectInjectedJs();

  let injectedReady = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "WHATNOT_SPY_INJECTED_READY") { injectedReady = true; console.log("[TSU:legends-hobby] injected.js ready"); }
  });

  (async () => {
    for (let i = 0; i < 40 && !injectedReady; i++) await sleep(250);
    if (!injectedReady) { console.warn("[TSU:legends-hobby] injected.js never ready."); return; }

    const liveId = getLiveIdFromUrl();
    if (!liveId) { console.warn("[TSU:legends-hobby] No liveId in URL."); return; }

    const cfg = await getConfig();
    if (!cfg.bridgeUrl) { console.warn("[TSU:legends-hobby] Missing bridgeUrl."); return; }

    console.log("[TSU:legends-hobby] ── Starting ──");
    console.log("[TSU:legends-hobby] bridge:", cfg.bridgeUrl);
    console.log("[TSU:legends-hobby] key:   ", cfg.bridgeKey.slice(0,8) + "…");
    console.log("[TSU:legends-hobby] sport: ", cfg.sport, "(nil = auto-infer)");

    await sendEvent(cfg, { type: "overlay_warmup", liveId, sport: cfg.sport || "" });

    const seen = new Map();
    const lastCodeByListing = new Map();
    const buyerCounts = new Map();
    let lastSaleText = "—", loops = 0;

    while (true) {
      try {
        const sold  = await requestInjected("WHATNOT_SPY_FETCH_SOLD_ITEMS", { liveId, after: null });
        const nodes = (sold?.edges || []).map((e) => e?.node).filter(Boolean).reverse();

        for (const n of nodes) {
          const id = n?.id || n?._id || n?.createdAt || JSON.stringify(n);
          const buyer = n?.buyer?.username || n?.buyer?.name || n?.buyer?.displayName || "Unknown";
          const rawTitle = n?.listing?.title || n?.listing?.subtitle || n?.listing?.description || n?.title || n?.product?.title || "Sale";
          const title = stripPrefixTitle(rawTitle);

          const prevTitle = seen.get(id);
          if (prevTitle && prevTitle === title) continue;
          if (isBadTitle(rawTitle) || isBadTitle(title)) continue;
          seen.set(id, title);

          const price = parsePrice(n);
          if (isGiveawayLike(title, price.amount)) { seen.set(id, title); continue; }

          // Multi-sport: auto-infer sport from listing title
          const inferredSport = inferSportFromTitle(title);
          const sport = (cfg.sport && cfg.sport !== "nil") ? cfg.sport : inferredSport;
          const code  = sport && sport !== "nil" ? inferCodeFromTitle(title, sport) : inferCustomCodeFromTitle(title);

          lastSaleText = `${buyer} • ${title} • $${price.amount.toFixed(2)}`;
          buyerCounts.set(buyer, (buyerCounts.get(buyer) || 0) + 1);

          const eventPayload = {
            type: "team_sold", saleId: id, id, buyer, title,
            amount: price.amount, amountCents: price.cents, currency: price.currency,
            sport, code,
            listingId: n?.listing?.id || null,
            productId: n?.listing?.product?.id || n?.product?.id || null,
            liveId
          };

          const saleKey = String(eventPayload.saleId || eventPayload.id || "").trim();
          if (saleKey && eventPayload.code) {
            const prevCode = lastCodeByListing.get(saleKey);
            if (prevCode && prevCode !== eventPayload.code) {
              await sendEvent(cfg, { type: "team_unsold", code: prevCode, saleId: eventPayload.saleId, id: eventPayload.saleId, listingId: eventPayload.listingId || null, sport, liveId });
            }
            lastCodeByListing.set(saleKey, eventPayload.code);
          }

          await sendEvent(cfg, eventPayload);
        }

        loops++;
        if (loops % cfg.summaryEvery === 0) {
          let topBuyer = "—", topBuyerCount = 0;
          for (const [b, c] of buyerCounts.entries()) { if (c > topBuyerCount) { topBuyerCount = c; topBuyer = b; } }
          await sendEvent(cfg, { type: "stream_stats", topBuyer, lastSale: lastSaleText, liveId });
        }

        await sleep(cfg.pollMs);
      } catch (err) {
        console.warn("[TSU:legends-hobby] poll error:", err?.message || err);
        await sleep(5000);
      }
    }
  })();
})();
