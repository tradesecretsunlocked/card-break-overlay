// ===== CONFIG =====
const BRIDGE_ENDPOINT = "https://tsu-bridge.onrender.com/events"; // <-- your Render POST /events
const DEFAULT_SPORT = "nba"; // switch to "nfl" or "mlb" when needed

// ===== Break ID: YYYY-MM-DD + "-" + sport =====
function pad(n){ return String(n).padStart(2,"0"); }
function datePart(d=new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function computeBreakId(sport){
  return `${datePart()}-${sport}`.toLowerCase();
}
function getCurrentBreakId(){
  // You can override via localStorage if you want: localStorage.setItem("tsu.break.sport","nfl")
  const sport = (localStorage.getItem("tsu.break.sport") || DEFAULT_SPORT).toLowerCase();
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
  const payload = {
    breakId: getCurrentBreakId(),
    breakType: (localStorage.getItem("tsu.break.sport") || DEFAULT_SPORT).toLowerCase(),
    teamCode,
    buyerName,
    ts: Date.now()
  };
  fetch(BRIDGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  }).catch(()=>{});
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
