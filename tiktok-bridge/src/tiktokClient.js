import { API_HOST, AUTH_HOST, APP_KEY, APP_SECRET, V } from "./config.js";
import { signRequest, timestamp } from "./sign.js";
import { log } from "./log.js";
import { saveShopAuth, markAuthRevoked } from "./store.js";

/** Business error codes worth branching on. Everything else is logged and thrown. */
export const ERR = {
  RATE_LIMITED: 36009002,
  TIMESTAMP: 36009004,
  IP_NOT_ALLOWLISTED: 36009033,
  EXPIRED_CREDENTIALS: 105002,
  SCOPE_MISMATCH: 105005,
  BAD_SIGNATURE: 106001,
  MISSING_SHOP_CIPHER: 106013,
  AUTH_CODE_BAD: 36004004,
};

export class TikTokError extends Error {
  constructor(code, message, requestId, httpStatus) {
    super(`TikTok ${code}: ${message}`);
    this.code = code;
    this.requestId = requestId;
    this.httpStatus = httpStatus;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Signed request against the business API host.
 *
 * The body is stringified ONCE and the same string is both signed and transmitted.
 * Doing it any other way is how you get error 106001.
 */
export async function call({
  path,
  method = "GET",
  query = {},
  body = null,
  accessToken,
  shopCipher,
  retries = 3,
}) {
  const bodyString = body === null ? "" : JSON.stringify(body);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const q = { ...query, app_key: APP_KEY, timestamp: timestamp() };
    if (shopCipher) q.shop_cipher = shopCipher;

    q.sign = signRequest({ path, query: q, body: bodyString, appSecret: APP_SECRET });

    const url = `${API_HOST}${path}?${new URLSearchParams(q)}`;
    const headers = { "content-type": "application/json" };
    if (accessToken) headers["x-tts-access-token"] = accessToken;

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: bodyString || undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(`network failure calling ${path}: ${e.message}`);
    }

    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`non-JSON response from ${path} (HTTP ${res.status})`);
    }

    if (json.code === 0) return json.data;

    // Rate limited. Analytics endpoints live in the 0.2 to 1 req/sec bucket, so this
    // is expected under load rather than exceptional. Back off and retry.
    if ((json.code === ERR.RATE_LIMITED || res.status === 429) && attempt < retries) {
      const wait = 1000 * 2 ** attempt;
      log.warn("tiktok rate limited, backing off", { path, attempt, wait });
      await sleep(wait);
      continue;
    }

    // A clock skew or transient credential blip is worth exactly one retry, because
    // the timestamp is regenerated at the top of the loop.
    if (json.code === ERR.TIMESTAMP && attempt < 1) {
      await sleep(250);
      continue;
    }

    log.error("tiktok api error", {
      path,
      code: json.code,
      message: json.message,
      request_id: json.request_id,
    });
    throw new TikTokError(json.code, json.message, json.request_id, res.status);
  }

  throw new Error(`exhausted retries calling ${path}`);
}

/* ------------------------------------------------------------------ */
/* Token lifecycle                                                     */
/* ------------------------------------------------------------------ */

/**
 * Exchange an auth_code for tokens.
 *
 * grant_type is the literal string "authorized_code". That is NOT the standard OAuth
 * spelling and getting it wrong returns 36004004, which reads like an expired code and
 * sends people hunting in the wrong place.
 *
 * The auth_code itself expires in 30 minutes and is single use.
 */
export async function exchangeAuthCode(authCode) {
  const url = `${AUTH_HOST}/api/v2/token/get?${new URLSearchParams({
    app_key: APP_KEY,
    app_secret: APP_SECRET,
    auth_code: authCode,
    grant_type: "authorized_code",
  })}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const json = await res.json();
  if (json.code !== 0) throw new TikTokError(json.code, json.message, json.request_id, res.status);
  return json.data;
}

export async function refreshAccessToken(refreshToken) {
  const url = `${AUTH_HOST}/api/v2/token/refresh?${new URLSearchParams({
    app_key: APP_KEY,
    app_secret: APP_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  })}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const json = await res.json();
  if (json.code !== 0) throw new TikTokError(json.code, json.message, json.request_id, res.status);
  return json.data;
}

/**
 * Access tokens last 7 days. Refresh token expiry is an absolute timestamp only, so we
 * never derive a duration for it. Returns the refreshed auth row.
 */
export async function refreshAuthRow(auth) {
  try {
    const data = await refreshAccessToken(auth.refresh_token);
    const row = {
      ...auth,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? auth.refresh_token,
      access_expires_at: new Date(data.access_token_expire_in * 1000).toISOString(),
      refresh_expires_at: data.refresh_token_expire_in
        ? new Date(data.refresh_token_expire_in * 1000).toISOString()
        : auth.refresh_expires_at,
      status: "active",
      last_refresh_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    await saveShopAuth(row);
    log.info("refreshed tiktok token", { shop_id: auth.shop_id, bridge_key: auth.bridge_key });
    return row;
  } catch (e) {
    log.error("token refresh failed", { shop_id: auth.shop_id, error: e.message });
    if (e instanceof TikTokError && e.code === ERR.EXPIRED_CREDENTIALS) {
      await markAuthRevoked(auth.shop_id, `refresh failed: ${e.message}`);
    }
    throw e;
  }
}

/** Refreshes with a 2 day safety margin against the 7 day access token life. */
export async function ensureFreshToken(auth) {
  const expiresAt = new Date(auth.access_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 2 * 24 * 3600 * 1000) return auth;
  return refreshAuthRow(auth);
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export async function getAuthorizedShops(accessToken) {
  return call({ path: `/authorization/${V.authShops}/shops`, accessToken });
}

export async function searchOrders({ accessToken, shopCipher, filters = {}, pageSize = 50, pageToken }) {
  // Filters go in the BODY. Pagination goes in the QUERY STRING. Mixing them up
  // silently returns unfiltered results, which looks like the filter "not working".
  const query = { page_size: pageSize, sort_field: "update_time", sort_order: "ASC" };
  if (pageToken) query.page_token = pageToken;
  return call({
    path: `/order/${V.orderSearch}/orders/search`,
    method: "POST",
    query,
    body: filters,
    accessToken,
    shopCipher,
  });
}

/** Max 50 ids per call. */
export async function getOrders({ accessToken, shopCipher, ids }) {
  if (!ids?.length) return { orders: [] };
  if (ids.length > 50) throw new Error("getOrders accepts at most 50 ids per call");
  return call({
    path: `/order/${V.orderDetail}/orders`,
    query: { ids: ids.join(",") },
    accessToken,
    shopCipher,
  });
}

/* ---- Shop-level LIVE analytics -------------------------------------------
 * Scope `data.shop_analytics.public.read`, SELLER access token (user_type = 0),
 * and shop_cipher. These work with the SAME seller authorization the sold path
 * already uses, so they need no separate creator flow.
 *
 * Caveat from the docs: the minute-level and per-product session endpoints only
 * return data for streams hosted by the shop OFFICIAL or MARKETING account, and
 * interaction metrics are withheld for AFFILIATE_ACCOUNTS.
 * ------------------------------------------------------------------------- */

/** Session list. `id` here is the `live_id` the other shop_lives endpoints need. */
export async function getShopLivePerformanceList({
  accessToken,
  shopCipher,
  startDateGe,
  endDateLt,
  pageSize = 50,
  pageToken,
  accountType = "ALL",
  currency = "LOCAL",
}) {
  const query = {
    start_date_ge: startDateGe,
    end_date_lt: endDateLt,
    page_size: pageSize,
    account_type: accountType,
    currency,
  };
  if (pageToken) query.page_token = pageToken;
  return call({ path: `/analytics/${V.shopLives}/shop_lives/performance`, query, accessToken, shopCipher });
}

/** `today: true` overrides the date range and returns real-time shop LIVE metrics. */
export async function getShopLiveOverview({ accessToken, shopCipher, today = true, startDateGe, endDateLt, currency = "LOCAL" }) {
  const query = { currency };
  if (today) query.today = true;
  else Object.assign(query, { start_date_ge: startDateGe, end_date_lt: endDateLt });
  return call({ path: `/analytics/${V.shopLives}/shop_lives/overview_performance`, query, accessToken, shopCipher });
}

/** Full minute-by-minute series for one finished session. Feeds the recap card. */
export async function getShopLiveMinutePerformance({ accessToken, shopCipher, liveId, pageToken, currency = "LOCAL" }) {
  const query = { currency };
  if (pageToken) query.page_token = pageToken;
  return call({
    path: `/analytics/202510/shop_lives/${liveId}/performance_per_minutes`,
    query,
    accessToken,
    shopCipher,
  });
}

/* ---- Real-time LIVE room analytics ---------------------------------------
 * Scope `creator.data.live.read.public` and a CREATOR access token
 * (user_type = 1), obtained through the SEPARATE creator authorization flow at
 * shop.tiktok.com/alliance/creator/auth. Confirmed by the doc pages, which state
 * "The creator access_token value ... when user_type = 1".
 *
 * These take NO shop_cipher. Until the creator flow is built these will fail with
 * a permission error, which is why nothing calls them yet.
 * ------------------------------------------------------------------------- */

export async function getLiveRoomProductStats({ accessToken, roomId }) {
  // No shop_cipher: this family is creator scoped (creator.data.live.read.public).
  return call({ path: `/analytics/${V.liveRooms}/live_rooms/${roomId}/product_stats`, accessToken });
}

export async function getLiveRoomCoreStats({ accessToken, roomId }) {
  return call({ path: `/analytics/${V.liveRooms}/live_rooms/${roomId}/core_stats`, accessToken });
}

export async function listWebhooks({ accessToken, shopCipher }) {
  return call({ path: `/event/${V.webhooks}/webhooks`, accessToken, shopCipher });
}

export async function putWebhook({ accessToken, shopCipher, address, eventType }) {
  return call({
    path: `/event/${V.webhooks}/webhooks`,
    method: "PUT",
    body: { address, event_type: eventType },
    accessToken,
    shopCipher,
  });
}

export async function deleteWebhook({ accessToken, shopCipher, eventType }) {
  return call({
    path: `/event/${V.webhooks}/webhooks`,
    method: "DELETE",
    body: { event_type: eventType },
    accessToken,
    shopCipher,
  });
}
