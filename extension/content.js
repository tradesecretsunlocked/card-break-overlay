// ===== CONFIG =====
const CUSTOMER_CONFIG = {
  powerCardShop: {
    endpoint: "https://luccards-card-break-overlay.onrender.com/events",
    key: "power-secret"
  },
  luxCards: {
    endpoint: "https://tsu-bridge-luxcards.onrender.com/events",
    key: "lux-secret"
  },
  pmms: {
    endpoint: "https://tsu-bridge-pmm.onrender.com/events",
    key: "f19df96fe5697f8be7d31edcb5da689a"
  },
  dev: {
    endpoint: "https://tsu-bridge-dev.onrender.com/events",
    key: "dev-secret"
  }
};

const DEFAULT_CUSTOMER = "pmm";
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
  hawks:"ATL", celtics:"BOS", nets:"BKN", hornets:"CHA", bulls:"CHI",
  cavaliers:"CLE", mavericks:"DAL", nuggets:"DEN", pistons:"DET",
  warriors:"GSW", rockets:"HOU", pacers:"IND", clippers:"LAC",
  lakers:"LAL", grizzlies:"MEM", heat:"MIA", bucks:"MIL",
  timberwolves:"MIN", pelicans:"NOP", knicks:"NYK", thunder:"OKC",
  magic:"ORL", "76ers":"PHI", sixers:"PHI", suns:"PHX",
  blazers:"POR", kings:"SAC", spurs:"SAS", raptors:"TOR",
  jazz:"UTA", wizards:"WAS"
};
const CITY_HINTS = {
  "los angeles lakers":"LAL",
  "golden state":"GSW",
  "new york knicks":"NYK",
  "new orleans":"NOP"
};

function normalizeTeam(text){
  const t = text.toLowerCase();
  for (const [name, code] of Object.entries(TEAM_MAP)) {
    if (t.includes(name)) return code;
  }
  for (const [phrase, code] of Object.entries(CITY_HINTS)) {
    if (t.includes(phrase)) return code;
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
