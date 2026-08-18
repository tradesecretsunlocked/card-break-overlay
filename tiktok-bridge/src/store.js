import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./config.js";
import { log } from "./log.js";

export const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------------------------------------------ */
/* Entitlement                                                         */
/* ------------------------------------------------------------------ */

/**
 * A client may use TikTok only when BOTH booleans are true.
 * Same pattern as client_services on purpose: `enabled` true with `entitled` false
 * is the failure mode that produces a client whose every feature 403s with no other
 * symptom, and keeping the shape identical means the debugging instinct transfers.
 */
export async function isTikTokProvisioned(bridgeKey) {
  const { data, error } = await db
    .from("client_platforms")
    .select("entitled, enabled")
    .eq("bridge_key", bridgeKey)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (error) {
    log.error("isTikTokProvisioned failed", { bridgeKey, error: error.message });
    return false;
  }
  return Boolean(data?.entitled && data?.enabled);
}

export async function isActiveBridgeKey(bridgeKey) {
  if (!bridgeKey) return false;
  const { data, error } = await db
    .from("bridge_keys")
    .select("key, client_name, active, archived_at")
    .eq("key", bridgeKey)
    .maybeSingle();
  if (error || !data) return false;
  return data.active === true && !data.archived_at;
}

/* ------------------------------------------------------------------ */
/* Shop auth                                                           */
/* ------------------------------------------------------------------ */

export async function saveShopAuth(row) {
  const { error } = await db.from("tiktok_shop_auth").upsert(row, { onConflict: "shop_id" });
  if (error) throw new Error(`saveShopAuth: ${error.message}`);
}

export async function getShopAuthByBridgeKey(bridgeKey) {
  const { data, error } = await db
    .from("tiktok_shop_auth")
    .select("*")
    .eq("bridge_key", bridgeKey)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`getShopAuthByBridgeKey: ${error.message}`);
  return data;
}

export async function getShopAuthByShopId(shopId) {
  const { data, error } = await db
    .from("tiktok_shop_auth")
    .select("*")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw new Error(`getShopAuthByShopId: ${error.message}`);
  return data;
}

export async function listAuthsNeedingRefresh(withinHours = 48) {
  const cutoff = new Date(Date.now() + withinHours * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from("tiktok_shop_auth")
    .select("*")
    .eq("status", "active")
    .lt("access_expires_at", cutoff);
  if (error) throw new Error(`listAuthsNeedingRefresh: ${error.message}`);
  return data ?? [];
}

export async function markAuthRevoked(shopId, reason) {
  await db
    .from("tiktok_shop_auth")
    .update({ status: "revoked", last_error: reason ?? null, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId);
}

/* ------------------------------------------------------------------ */
/* OAuth state, single use                                             */
/* ------------------------------------------------------------------ */

export async function putOAuthState(state, bridgeKey) {
  const { error } = await db.from("tiktok_oauth_state").insert({ state, bridge_key: bridgeKey });
  if (error) throw new Error(`putOAuthState: ${error.message}`);
}

/** Consumes the state. Returns the bridge_key, or null when unknown, used, or expired. */
export async function consumeOAuthState(state) {
  const { data, error } = await db
    .from("tiktok_oauth_state")
    .select("state, bridge_key, created_at, consumed_at")
    .eq("state", state)
    .maybeSingle();

  if (error || !data) return null;
  if (data.consumed_at) return null;
  if (Date.now() - new Date(data.created_at).getTime() > 30 * 60 * 1000) return null;

  await db.from("tiktok_oauth_state").update({ consumed_at: new Date().toISOString() }).eq("state", state);
  return data.bridge_key;
}

/* ------------------------------------------------------------------ */
/* Webhook dedupe                                                      */
/* ------------------------------------------------------------------ */

/**
 * TikTok guarantees AT LEAST ONCE delivery and gives NO ordering guarantee.
 * Returns true when this notification has not been seen before.
 */
export async function claimNotification(notificationId, type, shopId) {
  if (!notificationId) return true; // nothing to dedupe on, let it through
  const { error } = await db
    .from("tiktok_webhook_log")
    .insert({ tts_notification_id: notificationId, event_type: type, shop_id: shopId ?? null });

  if (error) {
    if (error.code === "23505") return false; // unique violation, already handled
    log.error("claimNotification failed", { notificationId, error: error.message });
    return true; // fail open, a duplicate event is better than a dropped sale
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * Writes to the same bridge_events table the Whatnot bridge uses, with platform='tiktok'.
 * That one column is what makes v_sales, v_sales_daily and v_break_pnl cross-platform
 * without touching a single view definition.
 */
export async function recordEvent({ bridgeKey, clientName, channel = "main", eventType, payload }) {
  const { error } = await db.from("bridge_events").insert({
    bridge_key: bridgeKey,
    client_name: clientName ?? null,
    channel,
    event_type: eventType,
    payload,
    platform: "tiktok",
  });
  if (error) log.error("recordEvent failed", { bridgeKey, eventType, error: error.message });
}

/**
 * Guards against replaying a sale we already emitted, across restarts.
 *
 * THE GRAIN IS (saleId, code), NOT saleId ALONE.
 *
 * Verified against production on 2026-08-18: of 128,887 distinct saleIds in
 * `team_sold`, 93,487 carry MORE THAN ONE event and 78,142 span more than one `code`.
 * The worst case observed is a single saleId covering 31 different codes across 146
 * events. That is correct and expected: one buyer checking out once can take 31 tiles
 * off the board, and the board needs one event per tile.
 *
 * Deduping on saleId alone would therefore suppress every tile after the first and
 * silently under-report a large multi-team sale. On TikTok each line item already has
 * its own id, so this rarely bites, but the fallback saleId (`order:sku`) collapses
 * when a line item id is missing, and the contract grain is what should be encoded
 * here regardless of which platform is feeding it.
 */
export async function alreadyEmitted(bridgeKey, saleId, code) {
  let q = db
    .from("bridge_events")
    .select("id")
    .eq("bridge_key", bridgeKey)
    .eq("platform", "tiktok")
    .eq("payload->>saleId", saleId);

  if (code) q = q.eq("payload->>code", code);

  const { data, error } = await q.limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Live sessions                                                       */
/* ------------------------------------------------------------------ */

export async function upsertLiveSession({ bridgeKey, roomId, liveId, startedAt, breakId }) {
  const { error } = await db.from("tiktok_live_sessions").upsert(
    {
      bridge_key: bridgeKey,
      room_id: roomId,
      live_id: liveId ?? null,
      started_at: startedAt ?? new Date().toISOString(),
      break_id: breakId ?? null,
    },
    { onConflict: "bridge_key,room_id" }
  );
  if (error) log.error("upsertLiveSession failed", { bridgeKey, roomId, error: error.message });
}

export async function getActiveLiveSessions() {
  const { data, error } = await db
    .from("tiktok_live_sessions")
    .select("bridge_key, room_id, live_id, break_id")
    .is("ended_at", null);
  if (error) {
    log.error("getActiveLiveSessions failed", { error: error.message });
    return [];
  }
  return data ?? [];
}

/* ------------------------------------------------------------------ */
/* Cursor for the reconciliation poller                                */
/* ------------------------------------------------------------------ */

export async function getCursor(shopId) {
  const { data } = await db
    .from("tiktok_sync_cursor")
    .select("last_update_time")
    .eq("shop_id", shopId)
    .maybeSingle();
  return data?.last_update_time ?? null;
}

export async function setCursor(shopId, lastUpdateTime) {
  await db
    .from("tiktok_sync_cursor")
    .upsert({ shop_id: shopId, last_update_time: lastUpdateTime, updated_at: new Date().toISOString() },
      { onConflict: "shop_id" });
}
