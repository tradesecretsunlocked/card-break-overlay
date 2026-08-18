import "dotenv/config";

const req = (name, fallback) => {
  const v = (process.env[name] ?? fallback ?? "").trim();
  return v;
};

export const PORT = Number(process.env.PORT || 8788);
export const LOG_LEVEL = req("LOG_LEVEL", "info");

export const APP_KEY = req("TIKTOK_APP_KEY");
export const APP_SECRET = req("TIKTOK_APP_SECRET");
export const SERVICE_ID = req("TIKTOK_SERVICE_ID");

export const API_HOST = req("TIKTOK_API_HOST", "https://open-api.tiktokglobalshop.com");
export const AUTH_HOST = req("TIKTOK_AUTH_HOST", "https://auth.tiktok-shops.com");
export const AUTHORIZE_BASE = req("TIKTOK_AUTHORIZE_BASE", "https://services.us.tiktokshop.com/open/authorize");
export const PUBLIC_BASE_URL = req("PUBLIC_BASE_URL", `http://localhost:${PORT}`);

export const SUPABASE_URL = req("SUPABASE_URL");
export const SUPABASE_SERVICE_ROLE_KEY = req("SUPABASE_SERVICE_ROLE_KEY");

export const ADMIN_TOKENS = req("ADMIN_TOKENS")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * API VERSION MAP. Read this before changing anything.
 *
 * TikTok Shop versions every path as YYYYMM and ships multiple live versions of the
 * same endpoint at once. Two sources of truth disagree, verified 2026-08-16:
 *
 *   endpoint                     docv2 pages said   bundled OAS said
 *   live_rooms/*                 202502             202309
 *   blind_box_result/callback    202605             202511
 *
 * Neither source is guaranteed newest, so every version lives here and nowhere else,
 * and `npm run probe` (scripts/probe-versions.js) resolves the truth at runtime by
 * calling each candidate and keeping the first that does not 404.
 *
 * Never inline a version string anywhere else in this codebase.
 */
export const V = {
  authShops: "202309", // GET /authorization/{v}/shops
  orderSearch: "202309", // POST /order/{v}/orders/search
  orderDetail: "202507", // GET  /order/{v}/orders?ids=
  priceDetail: "202407", // GET  /order/{v}/orders/{id}/price_detail
  externalOrders: "202406", // POST /order/{v}/orders/external_orders
  webhooks: "202309", // GET|PUT|DELETE /event/{v}/webhooks
  liveRooms: "202309", // GET /analytics/{v}/live_rooms/{room}/... (candidates below)
  shopLives: "202509", // GET /analytics/{v}/shop_lives/...
  blindBox: "202511", // POST /order/{v}/orders/blind_box_result/callback
  productSearch: "202502", // POST /product/{v}/products/search
};

/** Candidates tried by the version probe, newest first. */
export const V_CANDIDATES = {
  liveRooms: ["202502", "202309"],
  blindBox: ["202605", "202511"],
  shopLives: ["202509", "202508", "202505"],
  orderDetail: ["202507", "202309"],
};

export function assertBootConfig() {
  const missing = [];
  if (!APP_KEY) missing.push("TIKTOK_APP_KEY");
  if (!APP_SECRET) missing.push("TIKTOK_APP_SECRET");
  if (!SERVICE_ID) missing.push("TIKTOK_SERVICE_ID");
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`
    );
  }
}
