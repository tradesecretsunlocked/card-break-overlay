// ===========================================================
//  TSU WHATNOT SALE BRIDGE — FULL REWRITE (Overlay-Synced)
//  Version: PMM v1.0 — Stable, Fuzzy Matching, Multi-Sport
// ===========================================================

// -------- CONFIG --------
const CUSTOMER_CONFIG = {
  powerCardShop: {
    endpoint: "https://tsu-bridge.onrender.com/events",
    key: "power-secret"
  },
  luxCards: {
    endpoint: "https://luccards-card-break-overlay.onrender.com/events",
    key: "a13b15c01bbe510f4e265df17be58096"
  },
  pmms: {
    endpoint: "https://tsu-bridge-pmm.onrender.com/events",
    key: "f19df96fe5697f8be7d31edcb5da689a"
  },
  dev: {
    endpoint: "https://tsu-bridge-dev.onrender.com/events",
    key: "714d51bd94575ee7aa0186c86b84d5e0"
  },
  lenhart: {
    endpoint: "https://tsu-bridge-lenhart.onrender.com/events",
    key: "0caf969c504e843aaec8144d9001399a"
  }
};

const DEFAULT_CUSTOMER = "lenhart";
const STORAGE_CUSTOMER = "tsu.customer";
const STORAGE_SPORT = "tsu.break.sport"; // fallback ONLY

// Debug toggle
const DEBUG = true;
function log(...a) { if (DEBUG) console.log("[TSU Bridge]", ...a); }

// -------- SPORT SYNC (Overlay controls sport) --------
function getActiveSport() {
  try {
    if (window.getTSUSport) {
      const s = window.getTSUSport();
      if (s) return s.toLowerCase();
    }
  } catch {}

  // fallback only if overlay is not visible
  return (localStorage.getItem(STORAGE_SPORT) || "nfl").toLowerCase();
}

// -------- DATE / BREAK ID --------
function pad(n) { return String(n).padStart(2, "0"); }
function datePart(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function computeBreakId(sport) {
  return `${datePart()}-${sport}`.toLowerCase();
}
function getCurrentBreakId() {
  return computeBreakId(getActiveSport());
}

// -------- BRIDGE CONFIG --------
function getCurrentCustomer() {
  return localStorage.getItem(STORAGE_CUSTOMER) || DEFAULT_CUSTOMER;
}
function getBridgeConfig() {
  const c = getCurrentCustomer();
  return CUSTOMER_CONFIG[c] || CUSTOMER_CONFIG[DEFAULT_CUSTOMER];
}

// ===========================================================
//  SANITIZATION HELPERS
// ===========================================================

// Remove emojis, symbols, funky unicode
function cleanText(raw) {
  if (!raw) return "";

  return raw
    .normalize("NFKD")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")     // emojis
    .replace(/[^\w\s]/g, " ")                    // punctuation
    .replace(/[\u0300-\u036f]/g, "")             // accents
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Mild Levenshtein distance
function editDistance(a, b) {
  if (!a || !b) return 99;
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

// ===========================================================
//  TEAM MAPS (Short names, full names, codes)
// ===========================================================
const TEAM_DATA = {
  nfl: {
    codes: [
      "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
      "HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ",
      "PHI","PIT","SF","SEA","TB","TEN","WAS"
    ],
    short: {
      cardinals:"ARI", cards:"ARI",
      falcons:"ATL",
      ravens:"BAL",
      bills:"BUF",
      panthers:"CAR",
      bears:"CHI",
      bengals:"CIN",
      browns:"CLE",
      cowboys:"DAL",
      broncos:"DEN",
      lions:"DET", lion:"DET", lionz:"DET",
      packers:"GB",
      texans:"HOU",
      colts:"IND",
      jaguars:"JAX", jags:"JAX",
      chiefs:"KC",
      raiders:"LV",
      chargers:"LAC",
      rams:"LAR",
      dolphins:"MIA",
      vikings:"MIN",
      patriots:"NE", pats:"NE",
      saints:"NO",
      giants:"NYG",
      jets:"NYJ",
      eagles:"PHI",
      steelers:"PIT",
      niners:"SF", "49ers":"SF",
      seahawks:"SEA",
      buccaneers:"TB", bucs:"TB",
      titans:"TEN",
      commanders:"WAS", skins:"WAS"
    },
    full: {
      "arizona cardinals":"ARI",
      "atlanta falcons":"ATL",
      "baltimore ravens":"BAL",
      "buffalo bills":"BUF",
      "carolina panthers":"CAR",
      "chicago bears":"CHI",
      "cincinnati bengals":"CIN",
      "cleveland browns":"CLE",
      "dallas cowboys":"DAL",
      "denver broncos":"DEN",
      "detroit lions":"DET",
      "green bay packers":"GB",
      "houston texans":"HOU",
      "indianapolis colts":"IND",
      "jacksonville jaguars":"JAX",
      "kansas city chiefs":"KC",
      "las vegas raiders":"LV",
      "los angeles chargers":"LAC",
      "los angeles rams":"LAR",
      "miami dolphins":"MIA",
      "minnesota vikings":"MIN",
      "new england patriots":"NE",
      "new orleans saints":"NO",
      "new york giants":"NYG",
      "new york jets":"NYJ",
      "philadelphia eagles":"PHI",
      "pittsburgh steelers":"PIT",
      "san francisco 49ers":"SF",
      "seattle seahawks":"SEA",
      "tampa bay buccaneers":"TB",
      "tennessee titans":"TEN",
      "washington commanders":"WAS"
    }
  },

  // NBA + MLB included in PART 2 of this code
};
// ===========================================================
//  TEAM DATA CONTINUED (MLB + NBA)
// ===========================================================

TEAM_DATA.mlb = {
  codes: [
    "ARI","ATL","BAL","BOS","CHC","CWS","CIN","CLE","COL","DET","HOU","KC",
    "LAA","LAD","MIA","MIL","MIN","NYM","NYY","OAK","PHI","PIT","SD","SF",
    "SEA","STL","TB","TEX","TOR","WAS"
  ],
  short: {
    diamondbacks:"ARI", dbacks:"ARI",
    braves:"ATL",
    orioles:"BAL",
    sox:"BOS", "red sox":"BOS",
    cubs:"CHC",
    whitesox:"CWS", "white sox":"CWS",
    reds:"CIN",
    guardians:"CLE",
    rockies:"COL",
    tigers:"DET",
    astros:"HOU",
    royals:"KC",
    angels:"LAA",
    dodgers:"LAD",
    marlins:"MIA",
    brewers:"MIL",
    twins:"MIN",
    mets:"NYM",
    yankees:"NYY",
    athletics:"OAK", "a's":"OAK", as:"OAK",
    phillies:"PHI",
    pirates:"PIT",
    padres:"SD",
    giants:"SF",
    mariners:"SEA",
    cardinals:"STL",
    rays:"TB",
    rangers:"TEX",
    bluejays:"TOR", jays:"TOR",
    nationals:"WAS"
  },
  full: {
    "arizona diamondbacks":"ARI",
    "atlanta braves":"ATL",
    "baltimore orioles":"BAL",
    "boston red sox":"BOS",
    "chicago cubs":"CHC",
    "chicago white sox":"CWS",
    "cincinnati reds":"CIN",
    "cleveland guardians":"CLE",
    "colorado rockies":"COL",
    "detroit tigers":"DET",
    "houston astros":"HOU",
    "kansas city royals":"KC",
    "los angeles angels":"LAA",
    "los angeles dodgers":"LAD",
    "miami marlins":"MIA",
    "milwaukee brewers":"MIL",
    "minnesota twins":"MIN",
    "new york mets":"NYM",
    "new york yankees":"NYY",
    "oakland athletics":"OAK",
    "philadelphia phillies":"PHI",
    "pittsburgh pirates":"PIT",
    "san diego padres":"SD",
    "san francisco giants":"SF",
    "seattle mariners":"SEA",
    "st louis cardinals":"STL",
    "tampa bay rays":"TB",
    "texas rangers":"TEX",
    "toronto blue jays":"TOR",
    "washington nationals":"WAS"
  }
};

TEAM_DATA.nba = {
  codes: [
    "ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND",
    "LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX",
    "POR","SAC","SAS","TOR","UTA","WAS"
  ],
  short: {
    hawks:"ATL",
    celtics:"BOS",
    nets:"BKN",
    hornets:"CHA",
    bulls:"CHI",
    cavaliers:"CLE",
    mavericks:"DAL", mavs:"DAL",
    nuggets:"DEN",
    pistons:"DET",
    warriors:"GSW", dubs:"GSW",
    rockets:"HOU",
    pacers:"IND",
    clippers:"LAC", clips:"LAC",
    lakers:"LAL", lakerz:"LAL", lakeerz:"LAL",
    grizzlies:"MEM",
    heat:"MIA",
    bucks:"MIL",
    timberwolves:"MIN", wolves:"MIN",
    pelicans:"NOP", pels:"NOP",
    knicks:"NYK",
    thunder:"OKC",
    magic:"ORL",
    "76ers":"PHI", sixers:"PHI",
    suns:"PHX",
    blazers:"POR",
    kings:"SAC",
    spurs:"SAS",
    raptors:"TOR",
    jazz:"UTA",
    wizards:"WAS"
  },
  full: {
    "atlanta hawks":"ATL",
    "boston celtics":"BOS",
    "brooklyn nets":"BKN",
    "charlotte hornets":"CHA",
    "chicago bulls":"CHI",
    "cleveland cavaliers":"CLE",
    "dallas mavericks":"DAL",
    "denver nuggets":"DEN",
    "detroit pistons":"DET",
    "golden state warriors":"GSW",
    "houston rockets":"HOU",
    "indiana pacers":"IND",
    "los angeles clippers":"LAC",
    "los angeles lakers":"LAL",
    "memphis grizzlies":"MEM",
    "miami heat":"MIA",
    "milwaukee bucks":"MIL",
    "minnesota timberwolves":"MIN",
    "new orleans pelicans":"NOP",
    "new york knicks":"NYK",
    "oklahoma city thunder":"OKC",
    "orlando magic":"ORL",
    "philadelphia 76ers":"PHI",
    "phoenix suns":"PHX",
    "portland trail blazers":"POR",
    "sacramento kings":"SAC",
    "san antonio spurs":"SAS",
    "toronto raptors":"TOR",
    "utah jazz":"UTA",
    "washington wizards":"WAS"
  }
};


// ===========================================================
//  UNIVERSAL NORMALIZE TEAM ENGINE
// ===========================================================

function normalizeTeam(rawText) {
  if (!rawText) return null;

  const sport = getActiveSport();
  const data = TEAM_DATA[sport];
  if (!data) return null;

  const cleaned = cleanText(rawText);
  if (!cleaned) return null;

  // ---- 1) Direct code match (DET, LAC, LAL, etc.) ----
  for (const code of data.codes) {
    if (cleaned.includes(code.toLowerCase())) {
      return code;
    }
  }

  // ---- 2) Full name exact match ----
  for (const [full, code] of Object.entries(data.full)) {
    if (cleaned.includes(full)) return code;
  }

  // ---- 3) Short name exact match ----
  for (const [short, code] of Object.entries(data.short)) {
    if (cleaned.includes(short)) return code;
  }

  // ---- 4) Mild fuzzy matching (short names only) ----
  const MAX_DIST = 2; // mild threshold

  for (const [short, code] of Object.entries(data.short)) {
    const dist = editDistance(cleaned, short);
    if (dist <= MAX_DIST) return code;

    // fuzzy for single-word focus
    const pieces = cleaned.split(" ");
    for (const p of pieces) {
      if (editDistance(p, short) <= MAX_DIST) {
        return code;
      }
    }
  }

  // ---- 5) Fuzzy full-name matching (mild) ----
  for (const [full, code] of Object.entries(data.full)) {
    const dist = editDistance(cleaned, full);
    if (dist <= MAX_DIST + 1) return code;

    const pieces = cleaned.split(" ");
    const fullPieces = full.split(" ");
    for (const p of pieces) {
      for (const f of fullPieces) {
        if (editDistance(p, f) <= MAX_DIST) return code;
      }
    }
  }

  return null;
}

// ===========================================================
//  BUYER EXTRACTION
// ===========================================================
function extractBuyer(text) {
  const re = /\b(?:purchased by|won by|buyer:)\s*@?([a-z0-9._-]{2,})\b/i;
  const m = text.match(re);
  return m ? m[1] : null;
}

// ===========================================================
//  POST SALE EVENT
// ===========================================================
function postSale(teamCode, buyerName) {
  if (!teamCode || !buyerName) return;

  const { endpoint, key } = getBridgeConfig();
  if (!endpoint) return;

  const payload = {
    breakId: getCurrentBreakId(),
    breakType: getActiveSport(),
    teamCode,
    buyerName,
    ts: Date.now()
  };

  log("POST →", payload);

  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-bridge-key": key } : {})
    },
    body: JSON.stringify(payload)
  }).catch(err => log("Fetch error:", err));
}
// ===========================================================
//  SEEN EVENT HANDLING (prevents duplicate triggers)
// ===========================================================

const seenKeys = new Set();
function makeSeenKey(text) {
  return cleanText(text).slice(0, 80);
}
function markSeen(k) {
  if (seenKeys.size > 500) {
    // prevent infinite growth
    const first = seenKeys.values().next().value;
    seenKeys.delete(first);
  }
  seenKeys.add(k);
}
function isSeen(k) {
  return seenKeys.has(k);
}


// ===========================================================
//  DEBOUNCED PROCESSING
// ===========================================================

let processTimeout = null;
let queue = [];

function scheduleProcess() {
  if (processTimeout) return;

  processTimeout = setTimeout(() => {
    processTimeout = null;
    const items = [...queue];
    queue = [];
    items.forEach(processText);
  }, 20); // 20ms debounce to avoid spam
}


// ===========================================================
//  CORE TEXT PROCESSOR
// ===========================================================

function processText(text) {
  if (!text) return;

  if (!/purchased by|won by|buyer:/i.test(text)) return;

  const key = makeSeenKey(text);
  if (isSeen(key)) return;

  const buyer = extractBuyer(text);
  const teamCode = normalizeTeam(text);

  log("Candidate:", { text, buyer, teamCode });

  if (buyer && teamCode) {
    markSeen(key);
    postSale(teamCode, buyer);
  }
}


// ===========================================================
//  MUTATION OBSERVER (optimized)
// ===========================================================

function handleMutations(muts) {
  for (const m of muts) {
    if (m.type === "childList") {
      m.addedNodes?.forEach(n => {
        if (n.nodeType === 3) {
          queue.push(n.textContent);
        } else if (n.nodeType === 1) {
          queue.push(n.innerText || n.textContent || "");
        }
      });
    }
    if (m.type === "characterData") {
      queue.push(m.target.textContent || "");
    }
  }

  if (queue.length > 0) scheduleProcess();
}


// ===========================================================
//  INIT OBSERVER
// ===========================================================

function initObserver() {
  const obs = new MutationObserver(handleMutations);
  obs.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });
  log("Observer started");
}


// ===========================================================
//  INIT EVERYTHING
// ===========================================================

function initTSUBridge() {
  log("content.js loaded — TSU Bridge Ready");

  initObserver();

  // For debugging manually:
  window.__TSU_normalizeTeam = normalizeTeam;
  window.__TSU_cleanText = cleanText;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTSUBridge);
} else {
  initTSUBridge();
}
