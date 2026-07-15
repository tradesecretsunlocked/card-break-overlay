(() => {
  /**
   * TSU Standard content.js — v2.2 (Multi-Tenant Bridge Edition)
   * FIXED: localStorage persistence for dedup map to prevent event floods on reload
   *
   * BUGS FIXED vs v2.0/v2.1:
   *  [CRITICAL] Pagination: fetches ALL sold items (not just first 24).
   *  [CRITICAL] team_sold suppressed when code cannot be resolved.
   *  [CRITICAL] seen map now set ONLY after a successful bridge POST.
   *  [CRITICAL] localStorage persistence: dedup map survives page reloads.
   *             Prevents 60+ historical sold items resending in one poll cycle.
   *  [RELIABILITY] Stable item ID: uses n.id, then listing+buyer composite.
   *  [RELIABILITY] Retry queue: failed POSTs retried up to 3x with backoff.
   *  [RELIABILITY] seen map capped at 1000 entries to prevent memory leak.
   *  [RELIABILITY] bridgeKey required at startup — fails fast.
   *  [MIGRATION] bridgeUrl locked as a constant.
   *  [STABILITY] injected.js has a duplicate-injection guard.
   */

  // ═══════════════════════════════════════════════════════════════
  // 1. CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  const BRIDGE_URL = "https://bridge.tradesecretsunlocked.com";

  // ⚠️ CANONICAL TEMPLATE — replace these three per client (see tsu-overlay-agent skill Step 7).
  //    bridgeKey: get from bridge_keys row created for this client
  //    sport:     "nfl" | "nba" | "mlb" | "nil" (multi-sport / infer from title)
  //    overlayId: {client-slug}-overlay (must match overlay HTML's overlayId in the warmup POST)
  const DEFAULTS = {
    bridgeKey:    "REPLACE_WITH_CLIENT_UUID_FROM_SUPABASE",
    sport:        "nil",
    overlayId:    "REPLACE_WITH_CLIENT_SLUG-overlay",
    channel:      "main",
    pollMs:       3000,
    summaryEvery: 5,
    // OPT-IN (default false — team clients keep normal suppression). When true, a sale whose
    // title doesn't map to a team code is still sent with code:"" so a custom / player-name
    // overlay can match the spot by title (e.g. WNBA player boards like Collect 4 Good).
    sendUnresolved: false
  };

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

    const match = inferTeamMatch(title);
    if (match) {
      if (!normalizedSport || normalizedSport === "nil" || match.sport === normalizedSport) {
        return match.code;
      }
    }

    const abbrevMatch = String(title || "").match(/\b([A-Z]{2,4})\b/);
    if (abbrevMatch) {
      const token = abbrevMatch[1].toUpperCase();
      const tokenRule = TEAM_TITLE_RULES.find(
        (r) => r.code === token &&
               (!normalizedSport || normalizedSport === "nil" || r.sport === normalizedSport)
      );
      if (tokenRule) return token;
    }

    const slotMatch = String(title || "").match(
      /^(?:#\s*)?(?:(?:envelope|env|spot|slot|number|no)\s*)?#?\s*(\d{1,3})\s*$/i
    );
    if (slotMatch) {
      const n = parseInt(slotMatch[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 150) {
        return `CUSTOM_${String(n).padStart(3, "0")}`;
      }
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
  // ═══════════════════════════════════════════════════════════════

  function stableId(n) {
    if (n?.id) return String(n.id);
    const lid = n?.listing?.id || "";
    const bid = n?.buyer?.id || "";
    if (lid || bid) return `${lid}_${bid}`;
    console.warn("[TSU] item missing stable ID — using random (will not dedup)", n);
    return `_unstable_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. LIVE ID
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
  // 6. INJECTED.JS BRIDGE
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
  // 7. PAGINATION — fetch ALL sold items across all pages
  // ═══════════════════════════════════════════════════════════════

  // Diagnostic: the most recent soldItems.totalCount Whatnot reported.
  let lastTotalCount = 0;

  // True if we've already processed this node with an unchanged title.
  // Mirrors the dedup check in the poll loop (stableId + stripped title).
  function isSeenUnchanged(n, seen) {
    if (!n) return false;
    const prev = seen.get(stableId(n));
    if (prev === undefined) return false;
    const rawTitle =
      n?.listing?.title ||
      n?.listing?.subtitle ||
      n?.listing?.description ||
      n?.title ||
      n?.product?.title ||
      "";
    return prev === stripPrefixTitle(rawTitle);
  }

  // ADAPTIVE PAGINATION - fixes the 24/7 deep-pagination 500 WITHOUT losing sales.
  // Old behavior: always walk up to MAX_PAGES into the full day-long order list.
  // On a marathon stream that list grows into the thousands, and Whatnot 500s on
  // the deep pages - and one failed page threw away the WHOLE poll, so it could
  // stay dark for hours.
  // New behavior: page from the NEWEST items and STOP once we reach a run of
  // items we've already handled. That walks exactly as deep as NEW data requires
  // (bursts + backlog still fully captured) but never drags through the giant
  // historical tail. A failed page keeps what we already pulled and resumes next
  // poll, so a transient 500 self-heals instead of going dark.
  async function fetchAllSoldEdges(liveId, seen) {
    const allEdges = [];
    let cursor = null;
    let seenPagesInARow = 0;
    let pageErrors = 0;
    let pagesWalked = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      let result;
      try {
        result = await requestInjected("WHATNOT_SPY_FETCH_SOLD_ITEMS", {
          liveId,
          after: cursor
        });
      } catch (e) {
        // Per-page isolation: keep the edges we already have, stop here.
        pageErrors++;
        console.warn(`[TSU] page ${page} fetch failed - keeping ${allEdges.length} edges, will resume next poll:`, e?.message || e);
        break;
      }

      pagesWalked++;
      const edges = result?.edges || [];
      allEdges.push(...edges);

      if (page === 0 && typeof result?.totalCount === "number") {
        lastTotalCount = result.totalCount;
      }

      // Early stop: once a whole page is already-processed we've caught up.
      // Require 2 consecutive fully-seen pages as a safety margin against any
      // minor ordering jitter before stopping - so we never truncate new sales.
      const pageAllSeen = edges.length > 0 && edges.every((e) => isSeenUnchanged(e?.node, seen));
      if (pageAllSeen) {
        if (++seenPagesInARow >= 2) break;
      } else {
        seenPagesInARow = 0;
      }

      const hasMore = result?.pageInfo?.hasNextPage && result?.pageInfo?.endCursor;
      if (!hasMore) break;
      cursor = result.pageInfo.endCursor;
    }

    if (pagesWalked >= MAX_PAGES) {
      console.warn(`[TSU] pagination hit MAX_PAGES=${MAX_PAGES} (totalCount~${lastTotalCount}) - backlog may exceed walk depth.`);
    }
    console.log(`[TSU] paged ${pagesWalked}p | ${allEdges.length} edges | totalCount~${lastTotalCount}${pageErrors ? " | pageErrors=" + pageErrors : ""}`);

    return allEdges;
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. CONFIG RESOLUTION
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
  // 9. BRIDGE POST — with retry
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
        if (attempt < maxRetries) await sleep(2000 * attempt);
      }
    }
    console.error(`[TSU] DROPPED after ${maxRetries} retries:`, payload);
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. MAIN LOOP
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

    // Load persisted dedup state from localStorage (survives page reloads)
    const savedSeen = localStorage.getItem('tsu.seen');
    const seen = new Map(savedSeen ? JSON.parse(savedSeen) : []);

    const lastCodeByItem   = new Map();
    const buyerCounts      = new Map();
    let lastSaleText       = "—";
    let loops              = 0;

    // seenSet with localStorage persistence
    function seenSetWithPersist(key, value) {
      if (seen.size >= 1000) {
        let i = 0;
        for (const k of seen.keys()) {
          seen.delete(k);
          if (++i >= 200) break;
        }
      }
      seen.set(key, value);
      try {
        localStorage.setItem('tsu.seen', JSON.stringify([...seen.entries()]));
      } catch (e) {
        console.warn("[TSU] localStorage persist failed:", e?.message);
      }
    }

    while (true) {
      try {
        const allEdges = await fetchAllSoldEdges(liveId, seen);
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

          const prevTitle = seen.get(id);
          if (prevTitle !== undefined && prevTitle === title) continue;

          if (isBadTitle(rawTitle) || isBadTitle(title)) continue;

          const price  = parsePrice(n);
          const amount = price.amount;
          if (isGiveawayLike(title, amount)) continue;

          const configuredSport = (cfg.sport || "").toLowerCase();
          const inferredSport   = inferTeamMatch(title)?.sport || "";
          const sport = (configuredSport && configuredSport !== "nil")
            ? configuredSport
            : inferredSport || "nil";

          const code = inferCodeFromTitle(title, sport);

          if (!code && !DEFAULTS.sendUnresolved) {
            console.warn("[TSU] unresolved title (will retry):", { id, title, sport, rawTitle });
            continue;
          }
          // passthrough (sendUnresolved): no team code resolved, but emit anyway with code:"" so a
          // custom/player-name overlay can match the spot from the title.

          const prevCode    = lastCodeByItem.get(id);
          const prevIsReal  = prevCode && !prevCode.startsWith("CUSTOM_");
          const newIsReal   = !!code && !code.startsWith("CUSTOM_");

          if (prevIsReal && newIsReal && prevCode !== code) {
            await sendEvent(cfg, {
              type:      "team_unsold",
              code:      prevCode,
              listingId: n?.listing?.id || null,
              liveId
            });
          }

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

          const ok = await sendEvent(cfg, eventPayload);
          if (ok) {
            seenSetWithPersist(id, title);
            lastCodeByItem.set(id, code);

            lastSaleText = `${buyer} • ${title} • $${amount.toFixed(2)}`;
            buyerCounts.set(buyer, (buyerCounts.get(buyer) || 0) + 1);
          }
        }

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
        console.warn("[TSU] poll error:", err?.message || err, "(soldItems totalCount~" + lastTotalCount + ")");
        await sleep(5000);
      }
    }
  })();
})();
