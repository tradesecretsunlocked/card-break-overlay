/**
 * TEAM CODE RESOLUTION.
 *
 * LIFTED VERBATIM from card-break-overlay/tsu-extension-v2.2/extension/content.js
 * (TEAM_TITLE_RULES, normalizeTitle, inferTeamMatch, inferCodeFromTitle,
 * stripPrefixTitle, isBadTitle) on 2026-08-16.
 *
 * WHY VERBATIM: the overlay board matches sold events on `code` / `teamCode`. If the
 * TikTok bridge resolved codes even slightly differently from the Whatnot extension,
 * the SAME break would light up different tiles depending on which platform the seller
 * was on. Copying the resolver instead of rewriting it makes drift impossible to
 * introduce by accident.
 *
 * WHEN THE EXTENSION CHANGES, RE-COPY THIS BLOCK. Do not hand-patch it.
 * Verified against the live contract: Whatnot emits code "MIN" for
 * "Minnesota Vikings" and "CUSTOM_022" for "#22".
 */

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

export { TEAM_TITLE_RULES, normalizeTitle, inferTeamMatch, inferCodeFromTitle, stripPrefixTitle, isBadTitle };
