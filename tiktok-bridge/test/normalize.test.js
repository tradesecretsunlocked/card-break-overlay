import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orderToEvents, productStatsToBoard, toCents, normalizeStatus, detectSaleFormat } from "../src/normalize.js";
import { validateSaleEvent, saleKey } from "../src/eventContract.js";

/**
 * The reference event is a REAL production row read out of bridge_events on
 * 2026-08-16 (client northland-breaks-overlay). Every assertion about shape is
 * checked against it so a TikTok event stays renderable by an unmodified overlay.
 */
const WHATNOT_REFERENCE_KEYS = [
  "id", "ts", "code", "type", "buyer", "sport", "title", "amount", "liveId",
  "saleId", "channel", "currency", "teamCode", "buyerName", "listingId",
  "productId", "overlay_id", "amountCents",
];
// Contract v2 and TikTok additions. Additive only: the Whatnot set above must stay a subset.
const ADDITIVE_KEYS = ["v", "platform", "saleFormat"];

const order = (over = {}) => ({
  id: "5789xxxxxxxxx",
  status: "UNPAID",
  buyer_nickname: "yanjos49778",
  line_items: [
    {
      id: "li_1",
      product_id: "p_1",
      sku_id: "sku_1",
      sku_name: "Minnesota Vikings",
      sale_price: "4.00",
      currency: "USD",
      room_id: "room_abc",
    },
  ],
  ...over,
});

test("emitted payload is the Whatnot production key set plus only the additive v2 keys", () => {
  const [e] = orderToEvents(order(), { overlayId: "northland-breaks-overlay", sport: "nfl" });
  assert.deepEqual(Object.keys(e.payload).sort(), [...WHATNOT_REFERENCE_KEYS, ...ADDITIVE_KEYS].sort());
});

test("every emitted event passes the shared contract in strict mode", () => {
  const [e] = orderToEvents(order(), { overlayId: "northland-breaks-overlay", sport: "nfl" });
  const r = validateSaleEvent(e.payload, { platform: "tiktok", strict: true });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(e.payload.v, 3);
  assert.equal(e.payload.platform, "tiktok");
});

test("src/eventContract.js is a byte copy of shared/eventContract.js", () => {
  const here = readFileSync(new URL("../src/eventContract.js", import.meta.url), "utf8");
  let shared;
  try { shared = readFileSync(new URL("../../shared/eventContract.js", import.meta.url), "utf8"); }
  catch { return; } // Render builds only tiktok-bridge/, the monorepo copy is absent there
  assert.equal(here, shared, "contract drifted, re-copy shared/eventContract.js into tiktok-bridge/src/");
});

test("LIVE auction orders are tagged saleFormat auction and otherwise identical", () => {
  const [a] = orderToEvents(order({ order_type: "AUCTION" }), { sport: "nfl" });
  const [f] = orderToEvents(order(), { sport: "nfl" });
  assert.equal(a.payload.saleFormat, "auction");
  assert.equal(f.payload.saleFormat, "fixed");
  assert.equal(a.payload.code, f.payload.code);
  assert.equal(detectSaleFormat({}), "fixed");
});

test("identity grain is saleId plus code, not saleId alone", () => {
  const o = order({ line_items: [
    { id: "li_a", sku_name: "Arizona Cardinals", sale_price: "3.00" },
    { id: "li_b", sku_name: "Minnesota Vikings", sale_price: "3.00" },
  ]});
  const keys = orderToEvents(o, { sport: "nfl" }).map((e) => saleKey(e.payload));
  assert.equal(new Set(keys).size, 2);
});

test("resolves the team code identically to the Whatnot extension", () => {
  const [e] = orderToEvents(order(), { sport: "nfl" });
  assert.equal(e.payload.code, "MIN");
  assert.equal(e.payload.teamCode, "MIN");
  assert.equal(e.eventType, "team_sold");
});

test("resolves numbered slots to the CUSTOM_nnn form the board expects", () => {
  const o = order({ line_items: [{ id: "li_9", sku_name: "#22", sale_price: "4.00" }] });
  const [e] = orderToEvents(o, { sport: "nil" });
  assert.equal(e.payload.code, "CUSTOM_022");
});

test("saleId is namespaced so TikTok can never collide with Whatnot in the overlay dedupe set", () => {
  const [e] = orderToEvents(order(), { sport: "nfl" });
  assert.equal(e.payload.saleId, "tt:li_1");
  assert.equal(e.payload.id, e.payload.saleId);
  assert.ok(e.payload.saleId.startsWith("tt:"));
});

test("UNPAID counts as sold, because that is when TikTok says to hold inventory", () => {
  const [e] = orderToEvents(order({ status: "UNPAID" }), { sport: "nfl" });
  assert.equal(e.eventType, "team_sold");
});

test("the webhook's CANCEL and the API's CANCELLED both release the slot", () => {
  assert.equal(normalizeStatus("CANCEL"), "CANCELLED");
  const [a] = orderToEvents(order({ status: "CANCEL" }), { sport: "nfl" });
  const [b] = orderToEvents(order({ status: "CANCELLED" }), { sport: "nfl" });
  assert.equal(a.eventType, "team_unsold");
  assert.equal(b.eventType, "team_unsold");
});

test("two of the same SKU are two line items and produce two events, never a multiplied one", () => {
  const o = order({
    line_items: [
      { id: "li_1", sku_name: "Arizona Cardinals", sale_price: "3.00" },
      { id: "li_2", sku_name: "Arizona Cardinals", sale_price: "3.00" },
    ],
  });
  const events = orderToEvents(o, { sport: "nfl" });
  assert.equal(events.length, 2);
  assert.notEqual(events[0].payload.saleId, events[1].payload.saleId);
  assert.equal(events[0].payload.amountCents, 300);
});

test("money is carried as integer cents and a matching decimal amount", () => {
  assert.equal(toCents("4.00"), 400);
  assert.equal(toCents("24.99"), 2499);
  assert.equal(toCents(null), 0);
  assert.equal(toCents("not a number"), 0);
  const [e] = orderToEvents(order(), { sport: "nfl" });
  assert.equal(e.payload.amountCents, 400);
  assert.equal(e.payload.amount, 4);
});

test("line items with no resolvable code are dropped rather than emitted untargeted", () => {
  const o = order({ line_items: [{ id: "li_x", sku_name: "Mystery Repack Box", sale_price: "10.00" }] });
  assert.equal(orderToEvents(o, { sport: "nfl" }).length, 0);
});

test("junk titles the extension already rejects are rejected here too", () => {
  const o = order({ line_items: [{ id: "li_y", sku_name: "Sale", sale_price: "1.00" }] });
  assert.equal(orderToEvents(o, { sport: "nfl" }).length, 0);
});

test("a status the board does not care about produces nothing", () => {
  assert.equal(orderToEvents(order({ status: "UNKNOWN_FUTURE_STATE" }), { sport: "nfl" }).length, 0);
});

test("liveId carries the TikTok room_id so orders can be grouped into a session later", () => {
  const [e] = orderToEvents(order(), { sport: "nfl" });
  assert.equal(e.payload.liveId, "room_abc");
});

test("productStatsToBoard yields sold and remaining per tile", () => {
  const board = productStatsToBoard(
    {
      product_stats: [
        {
          product_id: "p1",
          product_name: "Arizona Cardinals",
          paid_order_count: 2,
          created_order_count: 3,
          inventory_left_count: 1,
          is_live: true,
        },
        { product_id: "p2", product_name: "Unmatchable Thing", paid_order_count: 1 },
      ],
    },
    { sport: "nfl" }
  );
  assert.equal(board.length, 1);
  assert.deepEqual(
    { code: board[0].code, sold: board[0].sold, remaining: board[0].remaining, isLive: board[0].isLive },
    { code: "ARI", sold: 2, remaining: 1, isLive: true }
  );
});

/**
 * Regression tests for the dedupe grain.
 *
 * Production evidence (2026-08-18): of 128,887 distinct saleIds in team_sold, 93,487
 * carry more than one event and 78,142 span more than one code. One saleId covered 31
 * codes across 146 events. A single checkout legitimately takes many tiles off the
 * board, so saleId alone is NOT a unique key and must never be used as one.
 */
test("two identical SKUs still get distinct saleIds when the line item id is missing", () => {
  const o = {
    id: "order_1",
    status: "UNPAID",
    buyer_nickname: "b",
    line_items: [
      { sku_id: "sku_same", sku_name: "Arizona Cardinals", sale_price: "3.00" },
      { sku_id: "sku_same", sku_name: "Arizona Cardinals", sale_price: "3.00" },
    ],
  };
  const events = orderToEvents(o, { sport: "nfl" });
  assert.equal(events.length, 2);
  assert.notEqual(
    events[0].payload.saleId,
    events[1].payload.saleId,
    "an id-less fallback must not collide, or the replay guard swallows the second tile"
  );
});

test("one order spanning many teams yields one event per tile, all sharing the buyer", () => {
  const teams = ["Arizona Cardinals", "Minnesota Vikings", "Baltimore Ravens", "Atlanta Falcons"];
  const o = {
    id: "order_multi",
    status: "UNPAID",
    buyer_nickname: "whale",
    line_items: teams.map((t, i) => ({ id: `li_${i}`, sku_id: `s${i}`, sku_name: t, sale_price: "5.00" })),
  };
  const events = orderToEvents(o, { sport: "nfl" });
  assert.equal(events.length, 4);
  assert.deepEqual(events.map((e) => e.payload.code), ["ARI", "MIN", "BAL", "ATL"]);
  assert.equal(new Set(events.map((e) => e.payload.saleId)).size, 4);
  assert.ok(events.every((e) => e.payload.buyer === "whale"));
});

test("a saleFormat outside fixed or auction is rejected by the contract", () => {
  const [e] = orderToEvents(order(), { sport: "nfl" });
  const r = validateSaleEvent({ ...e.payload, saleFormat: "bogus" }, { platform: "tiktok" });
  assert.equal(r.ok, false);
});
