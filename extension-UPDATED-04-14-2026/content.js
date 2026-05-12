(() => {
  /**
   * TSU Standard content.js — v2.2 (Multi-Tenant Bridge Edition)
   *
   * BUGS FIXED vs v2.0/v2.1:
   *  [CRITICAL] Pagination: now fetches ALL sold items (not just first 24).
   *             Every NFL/NBA/MLB break was silently dropping spots past slot 24.
   *  [CRITICAL] team_sold suppressed when code cannot be resolved. Sending
   *             code:"" to the overlay caused undefined behavior / bad marks.
   *  [CRITICAL] seen map now set ONLY after a successful bridge POST. Previously,
   *             a network failure would mark the item seen and never retry it.
   *  [RELIABILITY] Stable item ID: uses n.id, then listing+buyer composite.
   *                Removed createdAt/JSON.stringify fallbacks — those were
   *                different every poll, breaking lastCodeByListing tracking
   *                and causing spurious team_unsold events.
   *  [RELIABILITY] Retry queue: failed POSTs retried up to 3x with backoff.
   *  [RELIABILITY] seen map capped at 1000 entries to prevent memory leak.
   *  [RELIABILITY] bridgeKey required at startup — fails fast with clear
   *                console error rather than silently sending 401s all session.
   *  [MIGRATION]   bridgeUrl locked as a constant — no longer in DEFAULTS.
   *                All clients share bridge.tradesecretsunlocked.com.
   *  [STABILITY]   injected.js has a duplicate-injection guard (see that file).
   *
   * PER-CLIENT SETUP (the only 3 things that differ between clients):
   *   bridgeKey  — 32-char hex, get from TSU Notion build queue
   *   sport      — "nfl" | "nba" | "mlb" | "nil" (nil = combo/infer)
   *   overlayId  — descriptive ID string, e.g. "jim-tabby-combo"
   */

  // ═══════════════════════════════════════════════════════════════
  // 1. CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  // LOCKED — same for every client. Do not change this per-client.
  const BRIDGE_URL = "https://bridge.tradesecretsunlocked.com";

  // CHANGE PER CLIENT — only these fields differ between clients.
  const DEFAULTS = {
    bridgeKey:    "REPLACE_WITH_CLIENT_KEY",  // required — 32-char hex
    sport:        "nil",                       // "nfl" | "nba" | "mlb" | "nil"
    overlayId:    "REPLACE_WITH_OVERLAY_ID",  // e.g. "jim-tabby-combo"
    channel:      "main",
    pollMs:       3000,
    summaryEvery: 5
  };

  // Pagination cap — 12 pages × 24 items = 288 slots max.
  // Covers any break format (32 NFL, 30 NBA, 30 MLB, custom envelopes, etc.)
  const MAX_PAGES = 12;

  // ═══════════════════════════════════════════════════════════════
  // 2. UTILS
  // ═══════════════════════════════════════════════════════════════

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const cleanSport = (s) => {
    const v = String(s || "").trim().toLowerCase();
    return ["nfl", "nba", "mlb", "nil"].includes(v) ? v : "";
  };

  const clampInt = (n, d, min, max) => {
    const v = parseInt(n, 10);
    return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d;
  };

  function isGiveawayLike(title, amount) {
    const s = String(title || "").trim().toLowerCase();
    const n = Number(amount || 0);
    return (
      s.startsWith("giveaway") ||
      s.includes(" giveaway") ||
      s === "sale" ||
      s === "—" ||
      (s.includes("bookmark future shows") && n <= 0)
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. TEAM / SPORT TITLE INFERENCE
  // ═══════════════════════════════════════════════════════════════

  const TEAM_TITLE_RULES = [
    // NFL
    { sport: "nfl", code: "ARI", names: ["arizona cardinals", "cardinals"] },
    { sport: "nfl", code: "ATL", names: ["atlanta falcons", "falcons"] },
    { sport: "nfl", code: "BAL", names: ["baltimore ravens", "ravens"] },
    { sport: "nfl", code: "BUF", names: ["buffalo bills", "bills"] },
    { sport: "nfl", code: "CAR", names: ["carolina panthers", "panthers"] },
    { sport: "nfl", code: "CHI", names: ["chicago bears", "bears"] },
    { sport: "nfl", code: "CIN", names: ["cincinnati bengals", "bengals"] },
    { sport: "nfl", code: "CLE", names: ["cleveland browns", "browns"] },
    { sport: "nfl", code: "DAL", names: ["dallas cowboys", "cowboys"] },
    { sport: "nfl", code: "DEN", names: ["denver broncos", "broncos"] },
    { sport: "nfl", code: "DET", names: ["detroit lions", "lions"] },
    { sport: "nfl", code: "GB",  names: ["green bay packers", "packers", "green bay"] },
    { sport: "nfl", code: "HOU", names: ["houston texans", "texans"] },
    { sport: "nfl", code: "IND", names: ["indianapolis colts", "colts"] },
    { sport: "nfl", code: "JAX", names: ["jacksonville jaguars", "jaguars", "jax jaguars"] },
    { sport: "nfl", code: "KC",  names: ["kansas city chiefs", "chiefs"] },
    { sport: "nfl", code: "LV",  names: ["las vegas raiders", "raiders"] },
    { sport: "nfl", code: "LAC", names: ["los angeles chargers", "la chargers", "chargers"] },
    { sport: "nfl", code: "LAR", names: ["los angeles rams", "la rams", "rams"] },
    { sport: "nfl", code: "MIA", names: ["miami dolphins", "dolphins"] },
    { sport: "nfl", code: "MIN", names: ["minnesota vikings", "vikings"] },
    { sport: "nfl", code: "NE",  names: ["new england patriots", "patriots"] },
    { sport: "nfl", code: "NO",  names: ["new orleans saints", "saints"] },
    { sport: "nfl", code: "NYG", names: ["new york giants", "ny giants"] },
    { sport: "nfl", code: "NYJ", names: ["new york jets", "ny jets"] },
    { sport: "nfl", code: "PHI", names: ["philadelphia eagles", "eagles"] },
    { sport: "nfl", code: "PIT", names: ["pittsburgh steelers", "steelers"] },
    { sport: "nfl", code: "SF",  names: ["san francisco 49ers", "49ers", "niners"] },
    { sport: "nfl", code: "SEA", names: ["seattle seahawks", "seahawks"] },
    { sport: "nfl", code: "TB",  names: ["tampa bay buccaneers", "buccaneers", "bucs"] },
    { sport: "nfl", code: "TEN", names: ["tennessee titans", "titans"] },
    { sport: "nfl", code: "WAS", names: ["washington commanders", "commanders"] },

    // NBA
    { sport: "nba", code: "ATL", names: ["atlanta hawks", "hawks"] },
    { sport: "nba", code: "BOS", names: ["boston celtics", "celtics"] },
    { sport: "nba", code: "BKN", names: ["brooklyn nets", "nets"] },
    { sport: "nba", code: "CHA", names: ["charlotte hornets", "hornets"] },
    { sport: "nba", code: "CHI", names: ["chicago bulls", "bulls"] },
    { sport: "nba", code: "CLE", names: ["cleveland cavaliers", "cavaliers", "cavs"] },
    { sport: "nba", code: "DAL", names: ["dallas mavericks", "mavericks", "mavs"] },
    { sport: "nba", code: "DEN", names: ["denver nuggets", "nuggets"] },
    { sport: "nba", code: "DET", names: ["detroit pistons", "pistons"] },
    { sport: "nba", code: "GSW", names: ["golden state warriors", "warriors"] },
    { sport: "nba", code: "HOU", names: ["houston rockets", "rockets"] },
    { sport: "nba", code: "IND", names: ["indiana pacers", "pacers"] },
    { sport: "nba", code: "LAC", names: ["la clippers", "los angeles clippers", "clippers"] },
    { sport: "nba", code: "LAL", names: ["la lakers", "los angeles lakers", "lakers"] },
    { sport: "nba", code: "MEM", names: ["memphis grizzlies", "grizzlies"] },
    { sport: "nba", code: "MIA", names: ["miami heat", "heat"] },
    { sport: "nba", code: "MIL", names: ["milwaukee bucks", "bucks"] },
    { sport: "nba", code: "MIN", names: ["minnesota timberwolves", "timberwolves", "wolves"] },
    { sport: "nba", code: "NOP", names: ["new orleans pelicans", "pelicans"] },
    { sport: "nba", code: "NYK", names: ["new york knicks", "knicks"] },
    { sport: "nba", code: "OKC", names: ["oklahoma city thunder", "thunder"] },
    { sport: "nba", code: "ORL", names: ["orlando magic", "magic"] },
    { sport: "nba", code: "PHI", names: ["philadelphia sixers", "philadelphia 76ers", "sixers", "76ers"] },
    { sport: "nba", code: "PHX", names: ["phoenix suns", "suns"] },
    { sport: "nba", code: "POR", names: ["portland trail blazers", "trail blazers", "blazers"] },
    { sport: "nba", code: "SAC", names: ["sacramento kings", "kings"] },
    { sport: "nba", code: "SAS", names: ["san antonio spurs", "spurs"] },
    { sport: "nba", code: "TOR", names: ["toronto raptors", "raptors"] },
    { sport: "nba", code: "UTA", names: ["utah jazz", "jazz"] },
    { sport: "nba", code: "WAS", names: ["washington wizards", "wizards"] },

    // MLB
    { sport: "mlb", code: "ARI", names: ["arizona diamondbacks", "diamondbacks", "dbacks", "d-backs"] },
    { sport: "mlb", code: "ATL", names: ["atlanta braves", "braves"] },
    { sport: "mlb", code: "BAL", names: ["baltimore orioles", "orioles"] },
    { sport: "mlb", code: "BOS", names: ["boston red sox", "red sox"] },
    { sport: "mlb", code: "CHC", names: ["chicago cubs", "cubs"] },
    { sport: "mlb", code: "CHW", names: ["chicago white sox", "white sox"] },
    { sport: "mlb", code: "CIN", names: ["cincinnati reds", "reds"] },
    { sport: "mlb", code: "CLE", names: ["cleveland guardians", "guardians"] },
    { sport: "mlb", code: "COL", names: ["colorado rockies", "rockies"] },
    { sport: "mlb", code: "DET", names: ["detroit tigers", "tigers"] },
    { sport: "mlb", code: "HOU", names: ["houston astros", "astros"] },
    { sport: "mlb", code: "KC",  names: ["kansas city royals", "royals"] },
    { sport: "mlb", code: "LAA", names: ["los angeles angels", "la angels", "angels"] },
    { sport: "mlb", code: "LAD", names: ["los angeles dodgers", "la dodgers", "dodgers"] },
    { sport: "mlb", code: "MIA", names: ["miami marlins", "marlins"] },
    { sport: "mlb", code: "MIL", names: ["milwaukee brewers", "brewers"] },
    { sport: "mlb", code: "MIN", names: ["minnesota twins", "twins"] },
    { sport: "mlb", code: "NYM", names: ["new york mets", "mets"] },
    { sport: "mlb", code: "NYY", names: ["new york yankees", "yankees"] },
    { sport: "mlb", code: "OAK", names: ["oakland athletics", "athletics", "a's", "as"] },
    { sport: "mlb", code: "PHI", names: ["philadelphia phillies", "phillies"] },
    { sport: "mlb", code: "PIT", names: ["pittsburgh pirates", "pirates"] },
    { sport: "mlb", code: "SD",  names: ["san diego padres", "padres"] },
    { sport: "mlb", code: "SF",  names: ["san francisco giants", "giants"] },
    { sport: "mlb", code: "SEA", names: ["seattle mariners", "mariners"] },
    { sport: "mlb", code: "STL", names: ["st louis cardinals", "st. louis cardinals"] },
    { sport: "mlb", code: "TB",  names: ["tampa bay rays", "rays"] },
    { sport: "mlb", code: "TEX", names: ["texas rangers", "rangers"] },
    { sport: "mlb", code: "TOR", names: ["toronto blue jays", "blue jays"] },
    { sport: "mlb", code: "WSH", names: ["washington nationals", "nationals"] }
  ];

  // Pre-expand and length-sort so longest match always wins (prevents
  // "cardinals" matching NFL ARI when "st. louis cardinals" should match MLB STL)
  const EXPANDED_RULES = (() => {
    const out = [];
    for (const rule of TEAM_TITLE_RULES) {
      for (const name of rule.names) {
        out.push({ sport: rule.sport, code: rule.code, name: normalizeTitle(name) });
      }
    }
    return out.sort((a, b) => b.name.length - a.name.length);
  })();

  function normalizeTitle(t) {
    return String(t || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\w\s.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferTeamMatch(title) {
    const s = normalizeTitle(title);
    if (!s) return null;
    for (const rule of EXPANDED_RULES) {
      if (s.includes(rule.name)) return { sport: rule.sport, code: rule.code };
    }
    return null;
  }

  function inferCodeFromTitle(title, sport) {
    const normalizedSport = String(sport || "").toLowerCase().trim();

    // Step 1: Full name match (longest-match-wins, sport-filtered if known)
    const match = inferTeamMatch(title);
    if (match) {
      if (!normalizedSport || normalizedSport === "nil" || match.sport === normalizedSport) {
        return match.code;
      }
    }

    // Step 2: Uppercase abbreviation token (e.g. "KC", "LAR")
    const abbrevMatch = String(title || "").match(/\b([A-Z]{2,4})\b/);
    if (abbrevMatch) {
      const token = abbrevMatch[1].toUpperCase();
      const tokenRule = TEAM_TITLE_RULES.find(
        (r) => r.code === token &&
               (!normalizedSport || normalizedSport === "nil" || r.sport === normalizedSport)
      );
      if (tokenRule) return token;
    }

    // Step 3: Numeric slot/envelope/spot → CUSTOM_NNN
    // Only reached when no team matched — prevents "Slot 5 - Chiefs" becoming CUSTOM
    const slotMatch = String(title || "").match(
      /^(?:#\s*)?(?:(?:envelope|env|spot|slot|number|no)\s*)?#?\s*(\d{1,3})\s*$/i
    );
    if (slotMatch) {
      const n = parseInt(slotMatch[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 150) {
        return `CUSTOM_${String(n).padStart(3, "0")}`;
      }
    }

    return ""; // unresolved
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
      else if (typeof p.value === "number") cents = p.value;
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

  // ═══════════════════════════════════════════════════════════════
  // 4. STABLE ITEM ID
  // Never use createdAt or JSON.stringify — those change between polls,
  // which breaks lastCodeByListing tracking and causes spurious unsolds.
  // ═══════════════════════════════════════════════════════════════

  function stableId(n) {
    if (n?.id) return String(n.id);
    // Composite fallback — stable as long as listing and buyer don't change
    const lid = n?.listing?.id || "";
    const bid = n?.buyer?.id || "";
    if (lid || bid) return `${lid}_${bid}`;
    console.warn("[TSU] item missing stable ID — using random (will not dedup)", n);
    return `_unstable_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. SEEN MAP — capped at 1000 entries to prevent memory leak
  // ═══════════════════════════════════════════════════════════════

  function seenSet(map, key, value) {
    if (map.size >= 1000) {
      // Evict oldest 200 (Map preserves insertion order)
      let i = 0;
      for (const k of map.keys()) {
        map.delete(k);
        if (++i >= 200) break;
      }
    }
    map.set(key, value);
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. LIVE ID
  // ═══════════════════════════════════════════════════════════════

  function getLiveIdFromUrl() {
    const href = location.href;
    const liveMatch = href.match(/\/live\/([a-z0-9-]+)/i);
    if (liveMatch?.[1]) return liveMatch[1];
    const uuidMatch = href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch?.[0]) return uuidMatch[0];
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. INJECTED.JS BRIDGE
  // ═══════════════════════════════════════════════════════════════

  function injectInjectedJs() {
    const src = chrome.runtime.getURL("injected.js");
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function requestInjected(type, { liveId, after } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        reject(new Error(`Injected timeout: ${type}`));
      }, 10000);

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
      window.postMessage({ type, requestId, liveId, after }, "*");
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. PAGINATION — fetch ALL sold items across all pages
  // FIX: previous version always passed after:null (first 24 items only).
  // ═══════════════════════════════════════════════════════════════

  async function fetchAllSoldEdges(liveId) {
    const allEdges = [];
    let cursor = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await requestInjected("WHATNOT_SPY_FETCH_SOLD_ITEMS", {
        liveId,
        after: cursor
      });

      const edges = result?.edges || [];
      allEdges.push(...edges);

      const hasMore = result?.pageInfo?.hasNextPage && result?.pageInfo?.endCursor;
      if (!hasMore) break;
      cursor = result.pageInfo.endCursor;
    }

    return allEdges;
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. CONFIG RESOLUTION
  // Reads from chrome.storage.sync, then localStorage overrides.
  // bridgeUrl is intentionally excluded — it's a locked constant.
  // ═══════════════════════════════════════════════════════════════

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULTS, (cfg) => {
        let bridgeKey    = String(cfg.bridgeKey || "").trim();
        let sport        = cleanSport(cfg.sport);
        let overlayId    = String(cfg.overlayId || "").trim();
        let channel      = String(cfg.channel || "main").trim().toLowerCase() || "main";
        let pollMs       = clampInt(cfg.pollMs, DEFAULTS.pollMs, 1000, 20000);
        let summaryEvery = clampInt(cfg.summaryEvery, DEFAULTS.summaryEvery, 1, 50);

        try {
          // localStorage overrides (useful for quick per-tab testing)
          const lsKey          = String(localStorage.getItem("tsu.bridgeKey") || "").trim();
          const lsSport        = cleanSport(localStorage.getItem("tsu.sport"));
          const lsOverlayId    = String(localStorage.getItem("tsu.overlayId") || "").trim();
          const lsChannel      = String(localStorage.getItem("tsu.channel") || "").trim().toLowerCase();
          const lsPollMs       = localStorage.getItem("tsu.pollMs");
          const lsSummaryEvery = localStorage.getItem("tsu.summaryEvery");

          if (lsKey)          bridgeKey    = lsKey;
          if (lsSport)        sport        = lsSport;
          if (lsOverlayId)    overlayId    = lsOverlayId;
          if (lsChannel)      channel      = lsChannel;
          if (lsPollMs)       pollMs       = clampInt(lsPollMs, pollMs, 1000, 20000);
          if (lsSummaryEvery) summaryEvery = clampInt(lsSummaryEvery, summaryEvery, 1, 50);
        } catch (_) {}

        resolve({ bridgeKey, sport, overlayId, channel, pollMs, summaryEvery });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. BRIDGE POST — with retry
  // FIX: previous version had no retry. One network blip = lost event.
  // FIX: bridgeUrl is now BRIDGE_URL constant (never from config).
  // ═══════════════════════════════════════════════════════════════

  async function postToBridge(cfg, payload) {
    const body = {
      ts: Date.now(),
      channel: cfg.channel || "main",
      overlay_id: cfg.overlayId || undefined,
      ...payload
    };

    const r = await fetch(`${BRIDGE_URL}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-key": cfg.bridgeKey,
        "x-api-key":    cfg.bridgeKey
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Bridge ${r.status}: ${txt.slice(0, 120)}`);
    }
  }

  async function sendEvent(cfg, payload, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await postToBridge(cfg, payload);
        console.log(`[TSU] ✓ ${payload.type}${payload.code ? " " + payload.code : ""}${payload.buyer ? " → " + payload.buyer : ""}`);
        return true;
      } catch (e) {
        console.warn(`[TSU] ✗ ${payload.type} attempt ${attempt}/${maxRetries}: ${e.message}`);
        if (attempt < maxRetries) await sleep(2000 * attempt); // 2s, 4s backoff
      }
    }
    console.error(`[TSU] DROPPED after ${maxRetries} retries:`, payload);
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // 11. MAIN LOOP
  // ═══════════════════════════════════════════════════════════════

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
    // Wait for injected.js
    for (let i = 0; i < 40 && !injectedReady; i++) await sleep(250);
    if (!injectedReady) {
      console.error("[TSU] injected.js never became ready — aborting.");
      return;
    }

    const liveId = getLiveIdFromUrl();
    if (!liveId) {
      console.error("[TSU] No liveId found in URL — aborting.");
      return;
    }

    const cfg = await getConfig();

    // FIX: Fail fast if bridgeKey is missing or is still the placeholder.
    // Previous version would silently POST with no key and get 401s all session.
    if (!cfg.bridgeKey || cfg.bridgeKey === "REPLACE_WITH_CLIENT_KEY") {
      console.error("[TSU] bridgeKey not set! Update DEFAULTS.bridgeKey in content.js for this client.");
      return;
    }

    console.log("[TSU] ══════════════════════════════════");
    console.log("[TSU] Bridge:", BRIDGE_URL);
    console.log("[TSU] liveId:", liveId);
    console.log("[TSU] channel:", cfg.channel, "| overlay:", cfg.overlayId || "(none)", "| sport:", cfg.sport || "nil");
    console.log("[TSU] poll:", cfg.pollMs, "ms | summaryEvery:", cfg.summaryEvery);
    console.log("[TSU] ══════════════════════════════════");

    await sendEvent(cfg, { type: "overlay_warmup", liveId, sport: cfg.sport || "" });

    // State tracking
    const seen             = new Map(); // itemId → last-seen title (set ONLY after successful send)
    const lastCodeByItem   = new Map(); // itemId → last team code sent (for unsold detection)
    const buyerCounts      = new Map(); // buyer → sale count
    let lastSaleText       = "—";
    let loops              = 0;

    while (true) {
      try {
        // ── Fetch ALL pages of sold items ──────────────────────────
        const allEdges = await fetchAllSoldEdges(liveId);

        // Process oldest → newest (reverse of Whatnot's newest-first order)
        // so if a spot was reassigned, we send sold-old → unsold-old → sold-new in order.
        const nodes = allEdges.map((e) => e?.node).filter(Boolean).reverse();

        for (const n of nodes) {
          const id = stableId(n);

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
            "";

          const title = stripPrefixTitle(rawTitle);

          // ── Dedup: skip if we already sent this exact title for this item ──
          const prevTitle = seen.get(id);
          if (prevTitle !== undefined && prevTitle === title) continue;

          // ── Filter: skip bad/empty titles (don't set seen — retry next poll) ──
          if (isBadTitle(rawTitle) || isBadTitle(title)) continue;

          // ── Filter: skip giveaways ──
          const price  = parsePrice(n);
          const amount = price.amount;
          if (isGiveawayLike(title, amount)) continue;

          // ── Resolve sport and team code ──
          const configuredSport = (cfg.sport || "").toLowerCase();
          const inferredSport   = inferTeamMatch(title)?.sport || "";
          const sport = (configuredSport && configuredSport !== "nil")
            ? configuredSport
            : inferredSport || "nil";

          const code = inferCodeFromTitle(title, sport);

          // FIX: Don't send team_sold with empty code — overlay can't handle it.
          // Don't set seen either — title might update next poll with a resolvable value.
          if (!code) {
            console.warn("[TSU] unresolved title (will retry):", { id, title, sport, rawTitle });
            continue;
          }

          // ── Unsold detection: same item, different real code = reassignment ──
          const prevCode    = lastCodeByItem.get(id);
          const prevIsReal  = prevCode && !prevCode.startsWith("CUSTOM_");
          const newIsReal   = !code.startsWith("CUSTOM_");

          if (prevIsReal && newIsReal && prevCode !== code) {
            // Send unsold for the previous assignment before marking the new one
            await sendEvent(cfg, {
              type:      "team_unsold",
              code:      prevCode,
              listingId: n?.listing?.id || null,
              liveId
            });
          }

          // ── Build the sale event ──
          const eventPayload = {
            type:        "team_sold",
            saleId:      id,
            id,
            buyer,
            buyerName:   buyer,
            title,
            amount,
            amountCents: price.cents,
            currency:    price.currency,
            sport,
            code,
            teamCode:    code,
            listingId:   n?.listing?.id || null,
            productId:   n?.listing?.product?.id || n?.product?.id || null,
            liveId
          };

          // ── Send to bridge (with retry) ──
          // FIX: Only update seen + lastCodeByItem AFTER successful send.
          // Previously, seen was set before sending, so failures were lost forever.
          const ok = await sendEvent(cfg, eventPayload);
          if (ok) {
            seenSet(seen, id, title);
            lastCodeByItem.set(id, code);

            lastSaleText = `${buyer} • ${title} • $${amount.toFixed(2)}`;
            buyerCounts.set(buyer, (buyerCounts.get(buyer) || 0) + 1);
          }
        }

        // ── Periodic stream stats summary ──
        loops++;
        if (loops % cfg.summaryEvery === 0) {
          let topBuyer = "—", topCount = 0;
          for (const [b, c] of buyerCounts.entries()) {
            if (c > topCount) { topCount = c; topBuyer = b; }
          }
          await sendEvent(cfg, {
            type:     "stream_stats",
            topBuyer,
            lastSale: lastSaleText,
            liveId
          });
        }

        await sleep(cfg.pollMs);

      } catch (err) {
        console.warn("[TSU] poll error:", err?.message || err);
        await sleep(5000); // back off on unexpected errors
      }
    }
  })();
})();
