import { inferCodeFromTitle, stripPrefixTitle, isBadTitle } from "./teamCodes.js";
import { withMirrors, validateSaleEvent, SALE_ID_PREFIX } from "./eventContract.js";

/**
 * TikTok order  ->  TSU `team_sold` event.
 *
 * THE WHOLE POINT OF THIS FILE: an existing overlay must render a TikTok sale without
 * being modified. So the output shape here is the Whatnot production shape read out of
 * bridge_events on 2026-08-16, PLUS the additive contract v2 fields (`v`, `platform`)
 * and the additive TikTok field `saleFormat`. Nothing was removed or renamed.
 *
 *   { id, ts, code, type:"team_sold", buyer, sport, title, amount, liveId, saleId,
 *     channel:"main", currency, teamCode, buyerName, listingId, productId,
 *     overlay_id, amountCents, v:3, platform:"tiktok", saleFormat:"fixed"|"auction" }
 *
 * Every payload is built from canonical fields, passed through withMirrors() so the
 * legacy mirrors are filled by the SAME function every platform uses, then validated
 * against shared/eventContract.js. src/eventContract.js is a byte copy (a test fails
 * if it drifts). An invalid payload is dropped and REPORTED, never emitted.
 *
 * Two TikTok specifics that shape the mapping:
 *
 * 1. THERE IS NO `quantity` FIELD ON A LINE ITEM. Two of the same SKU means two line
 *    items. That is convenient here, because the overlay wants one event per sold slot
 *    anyway, so we emit one event per line item and never multiply.
 *
 * 2. `saleId` IS NAMESPACED `tt:`. The Whatnot extension emits opaque base64 node ids.
 *    Namespacing guarantees a TikTok id can never collide with a Whatnot id inside the
 *    overlay's dedupe set, which matters for the minority of clients provisioned for
 *    both platforms.
 */

/** Order statuses that mean "this slot is taken". */
export const SOLD_STATUSES = new Set([
  "UNPAID", // fires BEFORE payment. TikTok's own guidance is to hold inventory here,
  // and for a break that is exactly the moment to mark the slot sold.
  "ON_HOLD",
  "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
  "PARTIALLY_SHIPPING",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
]);

/** Statuses that release a slot back to the board. */
export const UNSOLD_STATUSES = new Set([
  "CANCELLED",
  "CANCEL", // the webhook emits CANCEL while the API returns CANCELLED. Map both.
]);

export function normalizeStatus(status) {
  const s = String(status || "").toUpperCase();
  return s === "CANCEL" ? "CANCELLED" : s;
}

/** TikTok prices arrive as decimal strings. Cents is the safe integer to compare on. */
export function toCents(amount) {
  if (amount === null || amount === undefined || amount === "") return 0;
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * LIVE auctions (2026) arrive as ordinary orders with order_type AUCTION. The board and
 * overlay treat them identically; `saleFormat` is additive context for analytics only.
 * UNVERIFIED against a real auction order (Dev Shop may not be auction eligible), so
 * anything that is not clearly an auction is reported as "fixed".
 */
export function detectSaleFormat(order) {
  const t = String(order?.order_type || order?.selling_format || "").toUpperCase();
  return t === "AUCTION" ? "auction" : "fixed";
}

/**
 * BOARD WINDOW (added 2026-10-30). The board shows the break in progress. TikTok fires an
 * order event for EVERY status change (shipped, delivered, completed) and the poller
 * re-reads anything updated in the last 16 hours, so an order from a show weeks ago can
 * arrive today and, once its title resolves to a team, light a tile. Only orders created
 * inside this window may reach the board. Older ones are recorded as revenue only.
 * A missing create_time is treated as fresh so a real sale is never silently held back.
 */
export const DEFAULT_BOARD_WINDOW_MS = 6 * 3600 * 1000;

export function isOutsideBoardWindow(order, now = Date.now(), windowMs = DEFAULT_BOARD_WINDOW_MS) {
  const t = Number(order?.create_time ?? 0);
  if (!Number.isFinite(t) || t <= 0) return false;
  const ms = t < 1e12 ? t * 1000 : t; // TikTok sends unix seconds
  return now - ms > windowMs;
}

/**
 * Builds the sold and unsold events for one TikTok order.
 * Returns [] when the order is in a state the board does not care about.
 */
export function orderToEvents(order, ctx = {}) {
  const { overlayId = null, sport = "nil", breakId = null, onDrop } = ctx;
  // onDrop(reason, detail) lets the caller SEE a line item that was skipped.
  // Silently dropping a sale is the single most confusing failure this bridge can
  // produce: the webhook arrives, everything logs success, and the board stays dark.
  const drop = (reason, detail) => { try { onDrop && onDrop(reason, detail); } catch { /* never break the sale path */ } };

  const status = normalizeStatus(order?.status);
  const isSold = SOLD_STATUSES.has(status);
  const isUnsold = UNSOLD_STATUSES.has(status);
  if (!isSold && !isUnsold) return [];

  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
  if (!lineItems.length) return [];

  const buyer = order?.buyer_nickname || order?.buyer_user_id || "unknown";
  const saleFormat = detectSaleFormat(order);
  const events = [];

  for (let idx = 0; idx < lineItems.length; idx++) {
    const li = lineItems[idx];
    // Cancelled line items inside an otherwise live order release only themselves.
    const liStatus = normalizeStatus(li?.display_status || status);
    const lineIsUnsold = UNSOLD_STATUSES.has(liStatus);

    // TITLE SOURCE (fixed 2026-10-30). A TikTok line item has TWO names: `sku_name` (the
    // variant, which is the literal string "Default" on every single-variant listing) and
    // `product_name` (the listing title, e.g. "Minnesota Vikings"). The old code took
    // `sku_name || product_name`, and "Default" is truthy, so the real title was never
    // read and every sale from a single-variant listing was dropped as no_matching_tile.
    // Now each candidate is tried in order (variant first, so sellers who put the team in
    // the variant keep working) and the first one that resolves to a board tile wins.
    // "Default" is never a usable name.
    const candidates = [li?.sku_name, li?.product_name]
      .map((s) => String(s ?? "").trim())
      .filter((s) => s && s.toLowerCase() !== "default" && !isBadTitle(s));
    let rawTitle = "";
    let resolvedTitle = "";
    let resolvedCode = "";
    for (const cand of candidates) {
      const t = stripPrefixTitle(cand);
      const c = inferCodeFromTitle(t, sport);
      if (c) {
        rawTitle = cand;
        resolvedTitle = t;
        resolvedCode = c;
        break;
      }
    }
    if (!resolvedCode) {
      // Nothing resolved: keep the best human-readable name so the unmatched report shows
      // what the seller actually called the product instead of "Default".
      rawTitle = candidates[0] || String(li?.product_name ?? li?.sku_name ?? "").trim();
    }
    const cents = toCents(li?.sale_price ?? li?.original_price);
    // Money travels with the drop report. A sale that cannot light a tile is still
    // REAL REVENUE and must remain countable, so the caller gets everything it needs
    // to record it for reporting even though nothing goes to the board.
    const dropContext = {
      rawTitle,
      // Both raw names, so an unmatched report always shows what TikTok actually sent.
      skuName: li?.sku_name ?? null,
      listingTitle: li?.product_name ?? null,
      lineItemId: li?.id ?? null,
      skuId: li?.sku_id ?? null,
      productId: li?.product_id ?? null,
      amountCents: cents,
      currency: li?.currency || order?.payment?.currency || "USD",
      buyer,
      sport,
      idx,
    };

    if (isBadTitle(rawTitle)) {
      drop("unusable_title", dropContext);
      continue;
    }

    const title = resolvedTitle || stripPrefixTitle(rawTitle);
    const code = resolvedCode;
    // No resolvable code means the board has no tile to light. Emitting anyway would
    // put an untargeted event on the wire, so it is dropped and REPORTED.
    if (!code) {
      drop("no_matching_tile", { ...dropContext, title });
      continue;
    }

    // The index is in the fallback deliberately. Two of the same SKU are two separate
    // line items, so an id-less fallback of order:sku would collide and the second
    // tile would be silently swallowed by the replay guard.
    const saleId = `${SALE_ID_PREFIX.tiktok}${li?.id ?? `${order?.id}:${li?.sku_id}:${idx}`}`;
    const type = lineIsUnsold || isUnsold ? "team_unsold" : "team_sold";

    // Canonical fields only. withMirrors() fills id, teamCode, buyerName, amount, v, platform.
    const payload = withMirrors(
      {
        saleId,
        ts: Date.now(),
        code,
        type,
        buyer,
        sport,
        title,
        amountCents: cents,
        liveId: li?.room_id || order?.auto_combine_group_id || breakId || null,
        channel: "main",
        currency: li?.currency || order?.payment?.currency || "USD",
        listingId: li?.sku_id ?? null,
        productId: li?.product_id ?? null,
        overlay_id: overlayId,
        saleFormat,
      },
      "tiktok"
    );

    const check = validateSaleEvent(payload, { platform: "tiktok" });
    if (!check.ok) {
      drop("contract_violation", { ...dropContext, title, errors: check.errors });
      continue;
    }
    events.push({ eventType: type, payload });
  }

  return events;
}

/**
 * Live room product stats -> a board snapshot.
 * Not a sold event: this is the reconciliation view used to correct drift, and the
 * source of remaining counts the overlay shows next to each tile.
 */
export function productStatsToBoard(stats, ctx = {}) {
  const { sport = "nil" } = ctx;
  const rows = Array.isArray(stats?.product_stats) ? stats.product_stats : [];
  return rows
    .map((p) => {
      const title = stripPrefixTitle(p?.product_name || "");
      const code = inferCodeFromTitle(title, sport);
      if (!code) return null;
      return {
        code,
        title,
        productId: p?.product_id ?? null,
        sold: Number(p?.paid_order_count ?? 0),
        created: Number(p?.created_order_count ?? 0),
        remaining: Number(p?.inventory_left_count ?? 0),
        isLive: Boolean(p?.is_live),
        imageUrl: p?.main_image_url ?? null,
      };
    })
    .filter(Boolean);
}
