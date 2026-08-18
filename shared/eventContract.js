/**
 * TSU BRIDGE EVENT CONTRACT, v2. Single source of truth.
 *
 * Every emitter validates against this before putting an event on the wire:
 * the Whatnot extension, the Loupe extension, and the TikTok bridge.
 *
 * WHY THIS FILE EXISTS. On 2026-08-18 an audit of 305,511 production `team_sold`
 * rows found FIVE different payload key-sets for one event type. One client had been
 * emitting without `teamCode` and `buyerName` for months, 87,499 rows, 28 percent of
 * all sales, and nothing flagged it. It was harmless only because the overlay reads
 * `code` and never `teamCode`. The first feature written against `teamCode` would have
 * broken for that client alone, silently, mid-break.
 *
 * Redundancy without validation is not safety. It is a second thing to drift.
 *
 * RULES
 *   1. NEVER remove or rename a field. Overlay files are baked per client and hosted;
 *      you cannot update the fleet. Every change is additive.
 *   2. Canonical fields are what consumers read. Legacy mirrors are emitted for
 *      backward compatibility and MUST NOT be read by new code.
 *   3. Bump `v` when you add fields. Never reuse a version number.
 *
 * NOT a runtime dependency for overlays. Emitters and CI use it; overlays stay
 * self-contained single-file browser sources.
 */

export const CONTRACT_VERSION = 2;

export const PLATFORMS = ["whatnot", "loupe", "tiktok"];
export const CHANNELS = ["main", "sports"];

/** Canonical: read these. */
export const CANONICAL = ["saleId", "code", "buyer", "amountCents", "currency", "title", "sport", "channel"];

/**
 * Legacy mirrors: emitted, never read by new code.
 *   id        mirrors saleId
 *   teamCode  mirrors code
 *   buyerName mirrors buyer
 *   amount    mirrors amountCents / 100
 */
export const LEGACY_MIRRORS = { id: "saleId", teamCode: "code", buyerName: "buyer" };

export const SALE_EVENT_TYPES = ["team_sold", "team_unsold"];

/**
 * IDENTITY GRAIN IS (saleId, code). NOT saleId ALONE.
 *
 * Production evidence 2026-08-18: of 128,887 distinct saleIds, 93,487 carry more than
 * one event and 78,142 span more than one code. Worst case observed: one saleId across
 * 31 codes and 146 events. One buyer checking out once legitimately takes many tiles
 * off the board. Deduping on saleId alone silently swallows every tile after the first.
 */
export function saleKey(payload) {
  return `${payload?.saleId ?? payload?.id}::${payload?.code ?? payload?.teamCode}`;
}

/** `wn:` Whatnot, `lp:` Loupe, `tt:` TikTok. Prevents cross-platform id collision. */
export const SALE_ID_PREFIX = { whatnot: "wn:", loupe: "lp:", tiktok: "tt:" };

/**
 * Validate a sale event payload.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateSaleEvent(payload, { platform, strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const p = payload ?? {};

  if (typeof p !== "object" || Array.isArray(p)) {
    return { ok: false, errors: ["payload must be a plain object"], warnings };
  }

  // ---- identity ----------------------------------------------------------
  if (!p.saleId) errors.push("saleId is required (canonical identity)");
  if (!p.code) errors.push("code is required (the board joins tiles on this)");
  if (p.saleId && p.id && p.saleId !== p.id) errors.push("id must mirror saleId exactly");
  if (p.code && p.teamCode && p.code !== p.teamCode) errors.push("teamCode must mirror code exactly");
  if (p.buyer && p.buyerName && p.buyer !== p.buyerName) errors.push("buyerName must mirror buyer exactly");

  // ---- type --------------------------------------------------------------
  if (!p.type) errors.push("type is required");
  else if (!SALE_EVENT_TYPES.includes(p.type)) warnings.push(`unrecognized type "${p.type}"`);

  // ---- money -------------------------------------------------------------
  // amountCents is canonical because floats drift. amount is the mirror.
  if (p.amountCents === undefined || p.amountCents === null) {
    errors.push("amountCents is required (integer cents is the canonical money field)");
  } else if (!Number.isInteger(p.amountCents)) {
    errors.push("amountCents must be an integer");
  } else if (p.amount !== undefined && Math.round(Number(p.amount) * 100) !== p.amountCents) {
    errors.push(`amount (${p.amount}) does not match amountCents (${p.amountCents})`);
  }
  if (!p.currency) warnings.push("currency missing, consumers will assume USD");

  // ---- board context -----------------------------------------------------
  if (!p.title) warnings.push("title missing, the sold flash will have nothing to show");
  if (!p.sport) warnings.push("sport missing, defaults to nil");
  if (p.channel && !CHANNELS.includes(p.channel)) {
    errors.push(`channel must be one of ${CHANNELS.join(", ")} (got "${p.channel}")`);
  }
  if (!p.overlay_id) warnings.push("overlay_id missing, cross-client attribution will be weak");
  if (typeof p.ts !== "number") warnings.push("ts should be a millisecond epoch number");

  // ---- platform ----------------------------------------------------------
  if (platform) {
    if (!PLATFORMS.includes(platform)) errors.push(`unknown platform "${platform}"`);
    const prefix = SALE_ID_PREFIX[platform];
    if (prefix && p.saleId && !String(p.saleId).startsWith(prefix)) {
      warnings.push(`saleId should start with "${prefix}" on ${platform} to avoid cross-platform collision`);
    }
  }
  if (p.platform && !PLATFORMS.includes(p.platform)) errors.push(`unknown platform field "${p.platform}"`);

  // ---- v2 additions ------------------------------------------------------
  // Warnings not errors: v1 emitters are still in the field and must keep working.
  if (p.v === undefined) warnings.push("v missing, add v:2 so old shapes stay measurable");
  if (p.platform === undefined) warnings.push("platform missing, liveId is ambiguous without it");

  const failing = strict ? errors.concat(warnings) : errors;
  return { ok: failing.length === 0, errors, warnings };
}

/** Throwing wrapper for emitter code paths and tests. */
export function assertSaleEvent(payload, opts) {
  const r = validateSaleEvent(payload, opts);
  if (!r.ok) throw new Error(`invalid sale event: ${r.errors.join("; ")}`);
  return r;
}

/** Fills the legacy mirrors and the v2 fields from canonical values. */
export function withMirrors(payload, platform) {
  const p = { ...payload };
  if (p.saleId && !p.id) p.id = p.saleId;
  if (p.code && !p.teamCode) p.teamCode = p.code;
  if (p.buyer && !p.buyerName) p.buyerName = p.buyer;
  if (p.amountCents != null && p.amount === undefined) p.amount = p.amountCents / 100;
  if (p.v === undefined) p.v = CONTRACT_VERSION;
  if (platform && p.platform === undefined) p.platform = platform;
  return p;
}
