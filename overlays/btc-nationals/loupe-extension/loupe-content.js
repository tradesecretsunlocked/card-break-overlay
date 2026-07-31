(() => {
  "use strict";
  /**
   * TSU Loupe Adapter — content.js  (v1.0, 2026-07-29)
   * Runs on: loupetheapp.com  (a Chrome tab WATCHING the live Loupe stream)
   * Emits: the SAME canonical `team_sold` event to the SAME bridge as Whatnot.
   *
   * SOURCE OF TRUTH (decoded from two live captures, Jollijoseph Cards stream,
   * 2026-07-29): Loupe pushes live data through Firestore (project `loupe-1138`).
   *   sessions/{sessionId}                      -> live metadata (shop_id, live, viewerCount)
   *   sessions/{sessionId}/thread/{msgId}       -> chat + SALES
   *   sessions/{sessionId}/audience/{userId}    -> live viewer roster
   *
   * A thread doc is a SALE (not chat) when it carries `itemPriceCents` + `itemName`.
   *   itemPriceCents = integer CENTS (10500 -> $105.00)
   *   senderID / senderName = the buyer (winner)
   *   itemName = title, itemId = listing id, msg doc id = stable saleId
   *
   * Auth: Firebase Bearer JWT read fresh each cycle from the page's IndexedDB
   * (`firebaseLocalStorageDb`). The overlay + bridge are untouched: Loupe field
   * names never cross the bridge (anti-corruption layer).
   */

  // ============================ CONFIG =======================================
  // CANONICAL TEMPLATE — replace bridgeKey + overlayId per client. Session is auto-read
  // from the /broadcasts/{id} URL, so shopId is only a fallback. For the BTC-ready build
  // with the key baked in, see ./btc-loupe-extension/.
  const DEFAULTS = {
    bridgeUrl:  "https://bridge.tradesecretsunlocked.com", // SAME bridge as Whatnot
    bridgeKey:  "3bc79a79-5ed9-4bea-9c11-ef970abf743a",          // same key baked into the client's overlay
    firestoreProject: "loupe-1138",
    shopId:     "",          // OPTIONAL fallback only (URL is primary): client's Loupe shop_id
    sessionId:  "",          // OPTIONAL hard override: watch this session directly
    platform:   "loupe",     // source tag; overlay ignores it
    sport:      "nil",       // nfl | nba | mlb | nil (nil = infer/passthrough by title)
    titlePassthroughOnly: true , // true for player/product boards (code:"" + match by title); false for team breaks
    overlayId:  "btc-nationals",
    channel:    "main",
    pollMs:     3000,
    summaryEvery: 5
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getConfig() {
    const cfg = { ...DEFAULTS };
    try {
      const s = await new Promise((res) => chrome.storage.sync.get(null, res));
      for (const k of Object.keys(DEFAULTS)) if (s && s[k] != null) cfg[k] = s[k];
    } catch (_) {}
    const ls = (k) => { try { return localStorage.getItem("tsu." + k); } catch { return null; } };
    for (const k of ["bridgeUrl","bridgeKey","shopId","sessionId","sport","overlayId","channel","pollMs"]) {
      const v = ls(k); if (v != null && v !== "") cfg[k] = (k === "pollMs") ? +v : v;
    }
    const qs = new URLSearchParams(location.search);
    if (qs.get("session")) cfg.sessionId = qs.get("session").trim();
    if (qs.get("shop"))    cfg.shopId    = qs.get("shop").trim();
    return cfg;
  }

  // ============================ AUTH =========================================
  // Read the CURRENT Firebase access token from the page's IndexedDB each cycle.
  async function getToken() {
    try {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("firebaseLocalStorageDb");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const rows = await new Promise((res, rej) => {
        const tx = db.transaction("firebaseLocalStorage", "readonly");
        const rq = tx.objectStore("firebaseLocalStorage").getAll();
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      const user = rows.map((x) => x && x.value).find((v) => v && v.stsTokenManager);
      return user ? user.stsTokenManager.accessToken : null;
    } catch (e) {
      console.warn("[TSU-Loupe] token read failed:", e.message);
      return null;
    }
  }

  // ============================ FIRESTORE REST ===============================
  function fsBase(cfg) {
    return `https://firestore.googleapis.com/v1/projects/${cfg.firestoreProject}/databases/(default)/documents`;
  }

  // Decode a Firestore document's `fields` map into a plain JS object.
  function decodeFields(fields) {
    const out = {};
    if (!fields) return out;
    for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
    return out;
  }
  function decodeValue(v) {
    if (v == null) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("mapValue" in v) return decodeFields(v.mapValue.fields);
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
    return null;
  }

  async function fsPost(cfg, path, body, token) {
    const res = await fetch(fsBase(cfg) + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(body)
    });
    if (res.status === 401) throw new Error("token-expired");
    if (!res.ok) throw new Error("firestore-http-" + res.status);
    return res.json();
  }

  // The live session id is in the broadcast URL: loupetheapp.com/broadcasts/{sessionId}.
  // This equals the live `sessions/{id}` doc (confirmed: Jollijoseph /broadcasts/YYHv…
  // -> sessions/YYHv…/thread). Scheduled setup uses a different id (scheduled_sessions/…);
  // once live, the URL points at the live session, which is where sales post.
  function sessionIdFromUrl() {
    const m = location.pathname.match(/\/broadcasts\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  // Resolve the live sessionId. Priority: explicit override -> broadcast URL -> shop query.
  async function resolveSessionId(cfg, token) {
    if (cfg.sessionId) return cfg.sessionId;       // hard override wins
    const fromUrl = sessionIdFromUrl();
    if (fromUrl) return fromUrl;                    // watching /broadcasts/{id}
    if (!cfg.shopId) return null;                   // fallback: shop_id + live query
    const body = {
      structuredQuery: {
        from: [{ collectionId: "sessions" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "shop_id" }, op: "EQUAL", value: { stringValue: cfg.shopId } } },
              { fieldFilter: { field: { fieldPath: "live" }, op: "EQUAL", value: { booleanValue: true } } }
            ]
          }
        },
        limit: 1
      }
    };
    const rows = await fsPost(cfg, ":runQuery", body, token);
    const doc = (rows || []).map((r) => r.document).find(Boolean);
    return doc ? doc.name.split("/").pop() : null;
  }

  // Read the session doc (for viewerCount + name), returns decoded fields or null.
  async function fetchSession(cfg, sessionId, token) {
    try {
      const res = await fetch(`${fsBase(cfg)}/sessions/${sessionId}`, {
        headers: { "Authorization": "Bearer " + token }
      });
      if (!res.ok) return null;
      const j = await res.json();
      return decodeFields(j.fields);
    } catch { return null; }
  }

  // Pull thread docs created since `sinceIso`, oldest first.
  async function fetchThreadSince(cfg, sessionId, sinceIso, token) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: "thread" }],
        where: { fieldFilter: { field: { fieldPath: "created" }, op: "GREATER_THAN",
                 value: { timestampValue: sinceIso } } },
        orderBy: [{ field: { fieldPath: "created" }, direction: "ASCENDING" }],
        limit: 100
      }
    };
    const rows = await fsPost(cfg, `/sessions/${sessionId}:runQuery`, body, token);
    return (rows || [])
      .filter((r) => r.document)
      .map((r) => ({ id: r.document.name.split("/").pop(), ...decodeFields(r.document.fields) }));
  }

  // ============================ SALE DETECTION ===============================
  // Primary: a thread doc is a SALE when it carries itemPriceCents + itemName.
  // Fallback: an automated message whose content reads "<buyer> bought <item> for $<amt>!"
  // (defensive, in case structured fields ever vary on a settle).
  const SALE_CONTENT_RE = /^(.+?)\s+bought\s+(.+?)\s+for\s+\$([\d,]+(?:\.\d{1,2})?)\s*!?\s*$/i;
  function parseContentSale(doc) {
    const m = String(doc && doc.content || "").match(SALE_CONTENT_RE);
    if (!m) return null;
    return { buyer: m[1].trim(), title: m[2].trim(), cents: Math.round(parseFloat(m[3].replace(/,/g, "")) * 100) };
  }
  function isSale(doc) {
    if (doc && doc.itemPriceCents != null && doc.itemName != null && Number(doc.itemPriceCents) > 0) return true;
    return !!parseContentSale(doc); // fallback path
  }

  function toTeamSold(doc, sessionId, cfg) {
    const fallback = (doc.itemPriceCents == null || doc.itemName == null) ? parseContentSale(doc) : null;
    const title = String((doc.itemName != null ? doc.itemName : (fallback && fallback.title)) || "").trim();
    const cents = Number(doc.itemPriceCents != null ? doc.itemPriceCents : (fallback && fallback.cents)) || 0;
    const buyer = doc.senderName || doc.senderID || (fallback && fallback.buyer) || "";
    const code = cfg.titlePassthroughOnly ? "" : inferCodeFromTitle(title, cfg.sport);
    return {
      type: "team_sold",
      saleId: doc.id, id: doc.id,          // stable dedupe key (thread doc id)
      buyer, buyerName: buyer,
      title,
      amount: cents / 100, amountCents: cents, currency: "USD",
      sport: cfg.sport,
      code, teamCode: code,
      listingId: doc.itemId || "", productId: doc.itemId || "",
      liveId: sessionId,
      platform: cfg.platform
    };
  }

  // ============================ BRIDGE POST ==================================
  async function sendEvent(cfg, payload) {
    try {
      await fetch(cfg.bridgeUrl + "/events", {
        method: "POST",
        headers: { "Content-Type": "application/json",
                   "x-bridge-key": cfg.bridgeKey, "x-api-key": cfg.bridgeKey },
        body: JSON.stringify({ ...payload, channel: cfg.channel })
      });
    } catch (e) {
      console.warn("[TSU-Loupe] bridge POST failed:", e.message);
    }
  }

  // ============================ DEDUPE (persisted) ===========================
  function loadSeen(cfg) {
    try {
      const raw = localStorage.getItem(`tsu.loupe.seen.${cfg.bridgeKey}`);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }
  function saveSeen(cfg, seen) {
    try {
      const arr = Array.from(seen).slice(-1000); // cap to avoid unbounded growth
      localStorage.setItem(`tsu.loupe.seen.${cfg.bridgeKey}`, JSON.stringify(arr));
    } catch {}
  }

  // ============================ MAIN LOOP ====================================
  async function main() {
    const cfg = await getConfig();
    if (!cfg.bridgeKey) { console.error("[TSU-Loupe] no bridgeKey configured"); return; }
    if (!cfg.shopId && !cfg.sessionId) {
      console.error("[TSU-Loupe] set tsu.shopId (or tsu.sessionId / ?shop= / ?session=) — nothing to watch");
      return;
    }

    const seen = loadSeen(cfg);
    // Only forward sales that happen AFTER the adapter starts (avoid replaying old chat/sales).
    let sinceIso = new Date().toISOString();
    let loops = 0, backoff = cfg.pollMs;

    await sendEvent(cfg, { type: "overlay_warmup", sport: cfg.sport, platform: cfg.platform, overlayId: cfg.overlayId });
    console.log("[TSU-Loupe] started. Watching", cfg.sessionId ? `session ${cfg.sessionId}` : `shop ${cfg.shopId}`);

    while (true) {
      try {
        const token = await getToken();
        if (!token) throw new Error("no-firebase-token"); // not logged in / session refreshing

        const sessionId = await resolveSessionId(cfg, token);
        if (!sessionId) { await sleep(cfg.pollMs); continue; } // not live yet

        const docs = await fetchThreadSince(cfg, sessionId, sinceIso, token);
        for (const doc of docs) {
          if (doc.created && doc.created > sinceIso) sinceIso = doc.created; // advance watermark
          if (!isSale(doc)) continue;                    // chat line, skip
          if (seen.has(doc.id)) continue;                // already sent
          if (isGiveawayLike(doc.itemName, Number(doc.itemPriceCents) / 100)) continue;
          seen.add(doc.id);
          await sendEvent(cfg, toTeamSold(doc, sessionId, cfg));
          saveSeen(cfg, seen);
          console.log("[TSU-Loupe] SOLD:", doc.senderName, "-", doc.itemName, "$" + (doc.itemPriceCents / 100).toFixed(2));
        }

        if (++loops % cfg.summaryEvery === 0) {
          const sess = await fetchSession(cfg, sessionId, token);
          await sendEvent(cfg, {
            type: "stream_stats", liveId: sessionId, platform: cfg.platform,
            viewerCount: sess ? Number(sess.viewerCount || 0) : null,
            streamName: sess ? sess.name : null
          });
        }
        backoff = cfg.pollMs;
      } catch (e) {
        console.warn("[TSU-Loupe] loop error:", e.message);
        backoff = Math.min(backoff * 1.5, 15000);
      }
      await sleep(backoff);
    }
  }

  // ==========================================================================
  //  REUSED CANONICAL HELPERS — pasted verbatim from the Whatnot content.js
  //  (extension-UPDATED-04-14-2026). DO NOT FORK: keep in sync with that file.
  // ==========================================================================
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

  const TEAM_TITLE_RULES = [
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

  function normalizeTitle(t) {
    return String(t || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\w\s.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const EXPANDED_RULES = (() => {
    const out = [];
    for (const rule of TEAM_TITLE_RULES) {
      for (const name of rule.names) out.push({ sport: rule.sport, code: rule.code, name: normalizeTitle(name) });
    }
    return out.sort((a, b) => b.name.length - a.name.length);
  })();

  function inferTeamMatch(title) {
    const s = normalizeTitle(title);
    if (!s) return null;
    for (const rule of EXPANDED_RULES) if (s.includes(rule.name)) return { sport: rule.sport, code: rule.code };
    return null;
  }

  function inferCodeFromTitle(title, sport) {
    const normalizedSport = String(sport || "").toLowerCase().trim();
    const match = inferTeamMatch(title);
    if (match && (!normalizedSport || normalizedSport === "nil" || match.sport === normalizedSport)) return match.code;
    const abbrevMatch = String(title || "").match(/\b([A-Z]{2,4})\b/);
    if (abbrevMatch) {
      const token = abbrevMatch[1].toUpperCase();
      const tokenRule = TEAM_TITLE_RULES.find(
        (r) => r.code === token && (!normalizedSport || normalizedSport === "nil" || r.sport === normalizedSport)
      );
      if (tokenRule) return token;
    }
    const slotMatch = String(title || "").match(/^(?:#\s*)?(?:(?:envelope|env|spot|slot|number|no)\s*)?#?\s*(\d{1,3})\s*$/i);
    if (slotMatch) {
      const n = parseInt(slotMatch[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 150) return `CUSTOM_${String(n).padStart(3, "0")}`;
    }
    return "";
  }

  main();
})();
