// ===== CONFIG =====
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
  }
};

const DEFAULT_CUSTOMER = "luxCards";
const DEFAULT_SPORT = "nba";
const STORAGE_CUSTOMER = "tsu.customer";
const STORAGE_SPORT = "tsu.break.sport";



// ===== Break ID: YYYY-MM-DD + "-" + sport =====
function pad(n){ return String(n).padStart(2,"0"); }
function datePart(d=new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function computeBreakId(sport){
  return `${datePart()}-${sport}`.toLowerCase();
}
function getCurrentCustomer(){
  return localStorage.getItem(STORAGE_CUSTOMER) || DEFAULT_CUSTOMER;
}
function getBridgeConfig(){
  const customer = getCurrentCustomer();
  return CUSTOMER_CONFIG[customer] || CUSTOMER_CONFIG[DEFAULT_CUSTOMER];
}
function getCurrentBreakId(){
  const sport = (localStorage.getItem(STORAGE_SPORT) || DEFAULT_SPORT).toLowerCase();
  return computeBreakId(sport);
}

// ===== Mapping team names in listing titles to overlay codes =====
const TEAM_MAP = {
  nba: {
    hawks:"ATL", celtics:"BOS", nets:"BKN", hornets:"CHA", bulls:"CHI",
    cavaliers:"CLE", mavericks:"DAL", nuggets:"DEN", pistons:"DET",
    warriors:"GSW", rockets:"HOU", pacers:"IND", clippers:"LAC",
    lakers:"LAL", grizzlies:"MEM", heat:"MIA", bucks:"MIL",
    timberwolves:"MIN", pelicans:"NOP", knicks:"NYK", thunder:"OKC",
    magic:"ORL", "76ers":"PHI", sixers:"PHI", suns:"PHX",
    blazers:"POR", kings:"SAC", spurs:"SAS", raptors:"TOR",
    jazz:"UTA", wizards:"WAS"
  },
  nfl: {
    cardinals:"ARI", cards:"ARI", falcons:"ATL", ravens:"BAL", bills:"BUF",
    panthers:"CAR", bears:"CHI", bengals:"CIN", browns:"CLE", cowboys:"DAL",
    broncos:"DEN", lions:"DET", packers:"GB", texans:"HOU", colts:"IND",
    jaguars:"JAX", jags:"JAX", chiefs:"KC", raiders:"LV", chargers:"LAC",
    rams:"LAR", dolphins:"MIA", vikings:"MIN", patriots:"NE", pats:"NE",
    saints:"NO", giants:"NYG", jets:"NYJ", eagles:"PHI", steelers:"PIT",
    niners:"SF", "49ers":"SF", seahawks:"SEA", buccaneers:"TB", bucs:"TB",
    titans:"TEN", commanders:"WAS", skins:"WAS"
  },
  mlb: {
    diamondbacks:"ARI", dbacks:"ARI", braves:"ATL", orioles:"BAL", sox:"BOS",
    "red sox":"BOS", cubs:"CHC", "white sox":"CWS", reds:"CIN", guardians:"CLE",
    rockies:"COL", tigers:"DET", astros:"HOU", royals:"KC", angels:"LAA",
    dodgers:"LAD", marlins:"MIA", brewers:"MIL", twins:"MIN", mets:"NYM",
    yankees:"NYY", athletics:"OAK", phillies:"PHI", pirates:"PIT",
    padres:"SD", giants:"SF", mariners:"SEA", cardinals:"STL", rays:"TB",
    rangers:"TEX", "blue jays":"TOR", jays:"TOR", nationals:"WAS"
  }
};
const TEAM_FULL_NAMES = {
  nba: {
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
  },
  nfl: {
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
  },
  mlb: {
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

function getActiveSport(){
  return (localStorage.getItem(STORAGE_SPORT) || DEFAULT_SPORT).toLowerCase();
}

function normalizeTeam(text){
  if (!text) return null;
  const t = text.toLowerCase();
  const cleaned = t.replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
  const sport = getActiveSport();
  const sportMap = TEAM_MAP[sport] || TEAM_MAP[DEFAULT_SPORT];
  const sportFullNames = TEAM_FULL_NAMES[sport] || TEAM_FULL_NAMES[DEFAULT_SPORT];
  for (const [name, code] of Object.entries(sportMap)) {
    if (t.includes(name)) return code;
  }
  for (const [phrase, code] of Object.entries(sportFullNames)) {
    if (cleaned.includes(phrase)) return code;
  }
  return null;
}

function extractBuyer(text){
  // Try common patterns: "purchased by USER", "won by @USER"
  // Adjust as the Whatnot UI changes
  const m1 = text.match(/purchased by\s+(@?[A-Za-z0-9_]+)/i);
  if (m1) return m1[1].replace(/^@/,"");
  const m2 = text.match(/won by\s+(@?[A-Za-z0-9_]+)/i);
  if (m2) return m2[1].replace(/^@/,"");
  const m3 = text.match(/buyer:\s*(@?[A-Za-z0-9_]+)/i);
  if (m3) return m3[1].replace(/^@/,"");
  return null;
}

function postSale(teamCode, buyerName) {
  if (!teamCode || !buyerName) return;
  const { endpoint, key } = getBridgeConfig();
  if (!endpoint) return;

  const payload = {
    breakId: getCurrentBreakId(),
    breakType: (localStorage.getItem(STORAGE_SPORT) || DEFAULT_SPORT).toLowerCase(),
    teamCode,
    buyerName,
    ts: Date.now()
  };

  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-bridge-key": key } : {})
    },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

// ===== MutationObserver to detect sales =====
// You will need to tweak selectors once while looking at the live DOM.
// Start with wide net, then narrow down.

const seen = new Set();
function processNode(el){
  const text = (el.textContent || "").trim();
  if (!text) return;

  // de-dup spammy toasts
  const key = text.slice(0,200);
  if (seen.has(key)) return;
  seen.add(key);

  const buyer = extractBuyer(text);
  const code  = normalizeTeam(text);

  if (buyer && code) postSale(code, buyer);
}

const obs = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.addedNodes) {
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1) {
          // likely sale toast / order row / chat line
          if (
            n.matches?.("[data-test-id*=sale], .sale-toast, .toast, [data-test-id*=order-row], .order-row, .chat-line, [role=alert]")
            || n.querySelector?.("[data-test-id*=sale], .sale-toast, .toast, [data-test-id*=order-row], .order-row, .chat-line, [role=alert]")
          ) {
            processNode(n);
          }
        }
      });
    }
  }
});

if (document.body) {
  obs.observe(document.body, { subtree:true, childList:true, characterData:true });
}
