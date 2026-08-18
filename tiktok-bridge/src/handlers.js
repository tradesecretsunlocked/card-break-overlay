import { getOrders, ensureFreshToken } from "./tiktokClient.js";
import { orderToEvents } from "./normalize.js";
import { broadcast } from "./sse.js";
import { log } from "./log.js";
import {
  getShopAuthByShopId,
  isTikTokProvisioned,
  recordEvent,
  alreadyEmitted,
  upsertLiveSession,
  db,
} from "./store.js";

/**
 * Per client overlay context: overlay_id, current sport, current break.
 *
 * THE SOURCE OF TRUTH IS THE OVERLAY ITSELF. On connect, every TSU overlay emits an
 * `overlay_warmup` event announcing its own overlay id, sport and break. Reading the
 * most recent one means a TikTok client needs no new configuration and can never drift
 * from what the board is actually showing.
 *
 * NOTE the key inconsistency in live data: warmup payloads use `overlay_id`,
 * `overlayId` OR `overlay` depending on overlay vintage. All three are accepted.
 * `client_platforms.overlay_id` is an explicit override for the case where a client is
 * provisioned before their overlay has ever connected.
 *
 * client_settings deliberately is NOT read here: verified 2026-08-16, it holds only
 * fee and timezone configuration and has no overlay, sport or break columns.
 */
async function getClientContext(bridgeKey) {
  const [{ data: warm }, { data: bk }, { data: plat }] = await Promise.all([
    db
      .from("bridge_events")
      .select("payload")
      .eq("bridge_key", bridgeKey)
      .eq("event_type", "overlay_warmup")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("bridge_keys").select("client_name").eq("key", bridgeKey).maybeSingle(),
    db
      .from("client_platforms")
      .select("overlay_id, default_sport")
      .eq("bridge_key", bridgeKey)
      .eq("platform", "tiktok")
      .maybeSingle(),
  ]);

  const p = warm?.payload ?? {};
  const overlayId = plat?.overlay_id || p.overlay_id || p.overlayId || p.overlay || null;
  const sport = p.sport || plat?.default_sport || "nil";

  return {
    overlayId,
    sport,
    breakId: p.breakId ?? p.break_id ?? null,
    clientName: bk?.client_name ?? null,
  };
}

/**
 * Topic 1, order status change. This is the sold trigger.
 *
 * The webhook payload carries only ids and a status, never the line items, so the
 * order has to be hydrated before it means anything to the board.
 */
export async function handleOrderStatusChange({ shopId, data }) {
  const orderId = data?.order_id;
  if (!orderId) return;

  const auth = await getShopAuthByShopId(shopId);
  if (!auth || auth.status !== "active") {
    log.warn("order webhook for a shop with no active auth", { shop_id: shopId });
    return;
  }

  if (!(await isTikTokProvisioned(auth.bridge_key))) {
    // entitled AND enabled must both be true. Silently ignoring here is correct:
    // the seller authorized, but TSU has not turned the platform on for them.
    log.info("ignoring order for a client not provisioned for tiktok", {
      bridge_key: auth.bridge_key,
    });
    return;
  }

  const fresh = await ensureFreshToken(auth);
  const detail = await getOrders({
    accessToken: fresh.access_token,
    shopCipher: fresh.shop_cipher,
    ids: [orderId],
  });

  const order = detail?.orders?.[0];
  if (!order) {
    log.warn("order hydration returned nothing", { order_id: orderId });
    return;
  }

  await emitOrder(order, fresh);
}

/** Shared by the webhook path and the reconciliation poller. */
export async function emitOrder(order, auth) {
  const ctx = await getClientContext(auth.bridge_key);
  const events = orderToEvents(order, ctx);
  if (!events.length) return 0;

  let emitted = 0;
  for (const ev of events) {
    // Survives restarts and the at-least-once webhook contract. The overlay dedupes
    // too, but a duplicate row in bridge_events would corrupt v_sales and the P&L.
    // Keyed on (saleId, code) because one sale legitimately covers many tiles: see
    // the note on alreadyEmitted().
    if (await alreadyEmitted(auth.bridge_key, ev.payload.saleId, ev.payload.code)) continue;

    broadcast(auth.bridge_key, ev.payload, "main");
    await recordEvent({
      bridgeKey: auth.bridge_key,
      clientName: ctx.clientName,
      channel: "main",
      eventType: ev.eventType,
      payload: ev.payload,
    });
    emitted++;
  }

  const roomId = order?.line_items?.find((li) => li?.room_id)?.room_id;
  if (roomId) {
    await upsertLiveSession({
      bridgeKey: auth.bridge_key,
      roomId,
      breakId: ctx.breakId,
    });
  }

  if (emitted) {
    log.info("emitted tiktok sale events", {
      bridge_key: auth.bridge_key,
      order_id: order.id,
      count: emitted,
    });
  }
  return emitted;
}

/**
 * Topic 27, inventory status change.
 *
 * This is the official "last one left" and "sold out" push, and it carries a full
 * distribution rather than a single number, so the board can distinguish stock that is
 * genuinely gone from stock reserved for a creator or a campaign.
 */
export async function handleInventoryChange({ shopId, data }) {
  const auth = await getShopAuthByShopId(shopId);
  if (!auth || auth.status !== "active") return;
  if (!(await isTikTokProvisioned(auth.bridge_key))) return;

  const ctx = await getClientContext(auth.bridge_key);
  const dist = data?.inventory_distribution ?? {};

  const payload = {
    type: "inventory_status",
    platform: "tiktok",
    ts: Date.now(),
    productId: data?.product_id ?? null,
    skuId: data?.sku_id ?? null,
    status: data?.current_inventory_status ?? null, // SUFFICIENT_STOCK | LOW_STOCK | OUT_OF_STOCK
    alertType: data?.trigger_reason?.alert_type ?? null, // PREDICTION | REALTIME
    available: Number(dist?.available_quantity ?? 0),
    total: Number(dist?.total_quantity ?? 0),
    committed: Number(dist?.committed_quantity ?? 0),
    creatorReserved: Number(dist?.creator_reserved_quantity ?? 0),
    campaignReserved: Number(dist?.campaign_reserved_quantity ?? 0),
    overlay_id: ctx.overlayId,
    channel: "main",
  };

  broadcast(auth.bridge_key, payload, "main");
  await recordEvent({
    bridgeKey: auth.bridge_key,
    clientName: ctx.clientName,
    channel: "main",
    eventType: "inventory_status",
    payload,
  });
}
