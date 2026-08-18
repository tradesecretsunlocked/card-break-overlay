import { searchOrders, ensureFreshToken, refreshAuthRow } from "./tiktokClient.js";
import { emitOrder } from "./handlers.js";
import { db, listAuthsNeedingRefresh, getCursor, setCursor } from "./store.js";
import { log } from "./log.js";

/**
 * RECONCILIATION POLLER.
 *
 * TikTok's own guidance: "Do not rely on webhooks as the only source of truth."
 * Delivery is at least once with no ordering guarantee, and the retry ladder runs
 * +2min, +30min, +3hr, +12hr before a message is dropped entirely. So the overlap
 * window has to be longer than that whole tail, which is 15.5 hours. 16 hours gives
 * a margin, and the alreadyEmitted() check makes the overlap free.
 */
const OVERLAP_MS = 16 * 3600 * 1000;

export async function reconcileShop(auth) {
  const fresh = await ensureFreshToken(auth);

  const cursor = await getCursor(fresh.shop_id);
  const since = cursor
    ? Math.floor(new Date(cursor).getTime() / 1000) - Math.floor(OVERLAP_MS / 1000)
    : Math.floor((Date.now() - OVERLAP_MS) / 1000);

  let pageToken;
  let scanned = 0;
  let emitted = 0;
  let maxUpdate = 0;

  do {
    const page = await searchOrders({
      accessToken: fresh.access_token,
      shopCipher: fresh.shop_cipher,
      // Filters go in the BODY. Pagination goes in the QUERY STRING.
      filters: { update_time_ge: since },
      pageSize: 50,
      pageToken,
    });

    const orders = page?.orders ?? [];
    for (const order of orders) {
      scanned++;
      emitted += await emitOrder(order, fresh);
      const u = Number(order?.update_time ?? 0);
      if (u > maxUpdate) maxUpdate = u;
    }

    pageToken = page?.next_page_token || null;
  } while (pageToken);

  if (maxUpdate) await setCursor(fresh.shop_id, new Date(maxUpdate * 1000).toISOString());

  if (scanned) {
    log.info("reconciled tiktok orders", {
      bridge_key: fresh.bridge_key,
      shop_id: fresh.shop_id,
      scanned,
      emitted,
    });
  }
  return { scanned, emitted };
}

export async function reconcileAll() {
  const { data: auths, error } = await db
    .from("tiktok_shop_auth")
    .select("*")
    .eq("status", "active");

  if (error) {
    log.error("reconcileAll could not list auths", { error: error.message });
    return;
  }

  for (const auth of auths ?? []) {
    try {
      await reconcileShop(auth);
    } catch (e) {
      log.error("reconcile failed for shop", { shop_id: auth.shop_id, error: e.message });
    }
  }
}

/**
 * TOKEN REFRESH WORKER.
 * Access tokens last 7 days. Refreshing anything inside a 48 hour margin daily means
 * a token would have to miss several consecutive runs before a client goes dark.
 */
export async function refreshExpiringTokens() {
  const due = await listAuthsNeedingRefresh(48);
  for (const auth of due) {
    try {
      await refreshAuthRow(auth);
    } catch (e) {
      log.error("scheduled refresh failed", { shop_id: auth.shop_id, error: e.message });
    }
  }
  if (due.length) log.info("token refresh sweep complete", { count: due.length });
}

let timers = [];

export function startWorkers({ reconcileMs = 5 * 60 * 1000, refreshMs = 12 * 3600 * 1000 } = {}) {
  stopWorkers();
  timers.push(setInterval(() => reconcileAll().catch(() => {}), reconcileMs));
  timers.push(setInterval(() => refreshExpiringTokens().catch(() => {}), refreshMs));

  // Do not hold the process open purely for a timer.
  for (const t of timers) t.unref?.();

  // Refresh once at boot so a restart after a long outage recovers immediately.
  refreshExpiringTokens().catch(() => {});
  log.info("background workers started", { reconcileMs, refreshMs });
}

export function stopWorkers() {
  for (const t of timers) clearInterval(t);
  timers = [];
}
