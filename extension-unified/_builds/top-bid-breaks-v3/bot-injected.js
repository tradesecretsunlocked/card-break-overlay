/**
 * TSU Whatnot Bot — bot-injected.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs in the PAGE CONTEXT (main world) — necessary because React tracks
 * input value changes via its own internal fiber. Setting `element.value`
 * directly from a content script doesn't trigger React's onChange; we must
 * use the native property setter, which this script has access to.
 *
 * Communication with content.js:
 *   content.js  → window.postMessage({ type: "TSU_BOT_POST_CHAT", ... })
 *   bot-injected.js → window.postMessage({ type: "TSU_BOT_CHAT_RESULT", ... })
 *   bot-injected.js → window.postMessage({ type: "TSU_BOT_GIVEAWAY_CHANGE", ... })
 */

(function () {
  // Guard against double-injection
  if (window.__TSU_BOT_INJECTED__) return;
  window.__TSU_BOT_INJECTED__ = true;

  // ── React-aware value setter ────────────────────────────────────────────────
  // The standard `element.value = x` approach bypasses React's synthetic event
  // system. This fires the native setter, then dispatches an 'input' event that
  // React's listener is watching for.

  function setReactInputValue(element, value) {
    const proto = element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (!descriptor || !descriptor.set) {
      // Fallback — some environments don't expose the descriptor
      element.value = value;
    } else {
      descriptor.set.call(element, value);
    }

    // Dispatch events React listens for
    element.dispatchEvent(new Event("input",  { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  }

  // ── Find an element using a prioritized selector list ──────────────────────
  function findElement(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) {
        // Invalid selector — skip silently
      }
    }
    return null;
  }

  // ── Post to Whatnot chat ────────────────────────────────────────────────────

  async function postChat(message, chatInputSelectors, chatSendSelectors, announce) {
    // 0. Announcements go out as Whatnot's /announce chat command, which highlights
    //    the message instead of letting it scroll by. Verified 2026-08-10: typing the
    //    command out in full behaves exactly like picking it from the "/" dropdown,
    //    and we set the whole string at once, so the suggestion menu never steers it.
    //    Guard against double prefixing if the seller typed the command themselves.
    const outbound = (announce && !message.startsWith("/announce "))
      ? "/announce " + message
      : message;

    // 1. Find the chat input
    const input = findElement(chatInputSelectors);
    if (!input) {
      throw new Error(
        "Chat input not found. The Whatnot DOM may have changed.\n" +
        "Tried selectors: " + chatInputSelectors.join(", ") + "\n" +
        "See PENDING.md → Step 1 for how to find the real selector."
      );
    }

    // 2. Focus the input
    input.focus();
    await delay(100);

    // 3. Set the message (React-aware)
    setReactInputValue(input, outbound);
    await delay(150);

    // 4. Submit. Whatnot chat is a single-line input that sends on Enter (no send
    //    button). Setting the value alone never submits, so escalate through:
    //    send button -> full Enter key sequence -> surrounding form submit.
    await delay(60);

    const sendBtn = findElement(chatSendSelectors);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      fireEnter(input);
    }

    // 5. Verify the field cleared; if our text is still there, escalate.
    await delay(250);
    if (input.value === outbound) {
      // Escalate 1: submit the surrounding form (fires React's onSubmit).
      const form = input.form || (input.closest && input.closest("form"));
      if (form) {
        try {
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        } catch (_) {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      }
      await delay(200);
    }
    if (input.value === outbound) {
      // Escalate 2: one more full Enter sequence directly on the focused input.
      input.focus();
      fireEnter(input);
      await delay(200);
    }

    // Honest result: if our text is STILL sitting in the box, the send never fired.
    // Report it as a real failure instead of a false "posted".
    if (input.value === outbound) {
      throw new Error("SEND_NOT_FIRED: text was set but the message did not send (Whatnot rejected Enter/submit). Needs a different send trigger.");
    }
  }

  // Dispatch a complete, React-friendly Enter keypress (keydown + keypress + keyup).
  function fireEnter(el) {
    const opts = {
      key: "Enter", code: "Enter", keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true, view: window,
    };
    el.dispatchEvent(new KeyboardEvent("keydown",  opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup",    opts));
  }

  // ── Giveaway DOM watcher ────────────────────────────────────────────────────
  // TODO: Update GIVEAWAY_ACTIVE_SELECTORS after DOM inspection (see PENDING.md)

  // ⚠️ STILL UNVERIFIED — verify when a giveaway is live (none was active during
  // inspection). Whatnot uses data-testid attributes. Bridge/manual triggers work
  // regardless of DOM auto-detection. Keep in sync with content.js.
  const GIVEAWAY_ACTIVE_SELECTORS = [
    "[data-testid*='giveaway' i]",
    "[class*='giveaway' i]",
    "[aria-label*='giveaway' i]",
  ];

  let giveawayWasActive = false;

  function checkGiveawayState() {
    let found = false;
    for (const sel of GIVEAWAY_ACTIVE_SELECTORS) {
      try {
        if (document.querySelector(sel)) { found = true; break; }
      } catch (_) {}
    }
    if (found !== giveawayWasActive) {
      giveawayWasActive = found;
      window.postMessage({ type: "TSU_BOT_GIVEAWAY_CHANGE", active: found }, "*");
    }
  }

  // DOM giveaway detection is unreliable (Whatnot has persistent "giveaway" tab/banner
  // elements + unverified selectors) — superseded by the network detector below.
  // setInterval(checkGiveawayState, 2000);

  // ── Giveaway NETWORK watcher (reliable) ─────────────────────────────────────
  // A Whatnot giveaway is a shop listing with transactionType === "GIVEAWAY" (plus a
  // transactionProps.giveaway block). Hook fetch + scan the liveStream/shop GraphQL
  // responses for it. Drives the same TSU_BOT_GIVEAWAY_CHANGE content.js handles.
  let giveawayNetActive = false;
  const GIVEAWAY_ENDED_STATUSES = new Set(["ended","cancelled","canceled","sold","closed","complete","completed","archived"]);
  function _tsuScanListings(obj, out, depth){
    if (!obj || typeof obj !== "object" || depth > 9) return;
    if (Object.prototype.hasOwnProperty.call(obj, "transactionType")) out.push(obj);
    for (const k in obj){ const v = obj[k]; if (v && typeof v === "object") _tsuScanListings(v, out, depth + 1); }
  }
  let _tsuActiveGiveawayId = null;
  function _tsuEvaluateGiveaway(json){
    const listings = [];
    try { _tsuScanListings(json, listings, 0); } catch (_) { return; }
    if (!listings.length) return;
    // CRITICAL FIX: a response that simply lacks the giveaway is NOT an "ended" signal.
    // Most sale/shop GraphQL responses omit the giveaway, which used to flap started/ended
    // on every poll. Only act on responses that actually contain a GIVEAWAY listing, and
    // only flip to inactive on an explicit ended status (deduped by giveaway id).
    const giveaways = listings.filter(l => String(l.transactionType || "").toUpperCase() === "GIVEAWAY");
    if (!giveaways.length) return; // no giveaway here -> leave state unchanged
    for (const g of giveaways){
      const gid = String(g.id || g.listingId || g.uuid || g.transactionId || "") || null;
      const ended = GIVEAWAY_ENDED_STATUSES.has(String(g.status || "").toLowerCase());
      if (!ended){
        if (!giveawayNetActive || (gid && _tsuActiveGiveawayId !== gid)){
          giveawayNetActive = true; _tsuActiveGiveawayId = gid;
          window.postMessage({ type: "TSU_BOT_GIVEAWAY_CHANGE", active: true }, "*");
        }
      } else {
        if (giveawayNetActive && (!_tsuActiveGiveawayId || _tsuActiveGiveawayId === gid)){
          giveawayNetActive = false; _tsuActiveGiveawayId = null;
          window.postMessage({ type: "TSU_BOT_GIVEAWAY_CHANGE", active: false }, "*");
        }
      }
    }
  }
  // Seller taps "Start giveaway" -> Whatnot fires a Segment analytics POST to
  // /services/events/v1/t containing story_start_giveaway / seller_*_giveaway_started.
  // The bot runs on the SELLER's dashboard, so this is the most reliable start signal.
  function _tsuCheckGiveawayStartText(txt){
    try {
      if (txt && /seller_sees_giveaway_started|story_start_giveaway|seller_taps_start_giveaway/i.test(txt)){
        if (!giveawayNetActive){ giveawayNetActive = true; window.postMessage({ type: "TSU_BOT_GIVEAWAY_CHANGE", active: true }, "*"); }
      }
    } catch (_) {}
  }

  const _tsuOrigFetch = window.fetch;
  window.fetch = function(...args){
    let url = "";
    try { url = (args[0] && args[0].url) || args[0] || ""; } catch (_) {}
    const p = _tsuOrigFetch.apply(this, args);
    // MERGE-SAFETY (v2.0): this extension now also contains the SALES module,
    // whose own GraphQL calls (LiveShopSold / LiveStreamSnapshot) return sold
    // listings that carry transactionType — including GIVEAWAY listings with no
    // `status` field. Feeding those into the giveaway evaluator would fire FALSE
    // "giveaway started" announcements. Skip our own operations explicitly.
    const _tsuOwnOp = typeof url === "string" &&
      /operationName=(LiveShopSold|LiveStreamSnapshot)/i.test(url);

    if (typeof url === "string" && /graphql/i.test(url) && !_tsuOwnOp){
      p.then(r => { try { r.clone().json().then(_tsuEvaluateGiveaway).catch(()=>{}); } catch(_){} }).catch(()=>{});
    }
    if (typeof url === "string" && /\/services\/events\/v1\//i.test(url)){
      try {
        const b = args[1] && args[1].body;
        if (typeof b === "string") _tsuCheckGiveawayStartText(b);
        else if (b && typeof b.text === "function") b.text().then(_tsuCheckGiveawayStartText).catch(()=>{});
      } catch (_) {}
    }
    return p;
  };

  // Segment sometimes uses navigator.sendBeacon for the same events endpoint — hook it too.
  try {
    const _tsuBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (_tsuBeacon){
      navigator.sendBeacon = function(u, d){
        try {
          if (typeof u === "string" && /\/services\/events\/v1\//i.test(u)){
            if (typeof d === "string") _tsuCheckGiveawayStartText(d);
            else if (d && typeof d.text === "function") d.text().then(_tsuCheckGiveawayStartText).catch(()=>{});
          }
        } catch (_) {}
        return _tsuBeacon(u, d);
      };
    }
  } catch (_) {}

  // ── Message listener ────────────────────────────────────────────────────────

  // ── v1.3 SELLER OWNERSHIP: who is hosting this show? ───────────────────────
  // Same query the sales extension uses. Runs in page context so Whatnot's
  // session cookies are attached.
  const TSU_GRAPHQL_URL = "https://www.whatnot.com/services/graphql/";

  function tsuCookie(name) {
    const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
  }

  async function fetchShowHost(liveId) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    const now = new Date();
    const version = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
    const headers = {
      "Content-Type": "application/json",
      "Accept": "*/*",
      "authorization": "Cookie",
      "x-client-timezone": tz,
      "x-whatnot-app": "whatnot-web",
      "x-whatnot-app-context": "next-js/browser",
      "x-whatnot-app-session-id": tsuCookie("ajs_anonymous_id") || tsuCookie("stable-id") || "tsu",
      "x-whatnot-app-user-session-id": tsuCookie("usid") || "tsu",
      "x-whatnot-app-version": version,
      "x-whatnot-usgmt": ",,",
      "x-whatnot-livestream-id": liveId,
      "x-whatnot-app-pathname": `/live/${liveId}`,
      "x-whatnot-app-screen": "/live/?"
    };
    const body = JSON.stringify({
      operationName: "LiveStreamSnapshot",
      variables: { id: liveId },
      query: `query LiveStreamSnapshot($id: ID!) { liveStream(id: $id) { id status title user { username __typename } __typename } }`
    });
    const res = await window.fetch(TSU_GRAPHQL_URL + "?operationName=LiveStreamSnapshot&ssr=0", {
      method: "POST", credentials: "include", headers, body
    });
    if (!res.ok) throw new Error(`GraphQL ${res.status}`);
    const payload = await res.json();
    if (payload?.errors?.length) throw new Error(payload.errors[0]?.message || "GraphQL error");
    return payload?.data?.liveStream?.user?.username || null;
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const { type } = ev.data || {};

    if (type === "TSU_BOT_FETCH_HOST") {
      try {
        const username = await fetchShowHost(ev.data.liveId);
        window.postMessage({ type: "TSU_BOT_HOST_RESULT", requestId: ev.data.requestId, success: true, username }, "*");
      } catch (err) {
        window.postMessage({ type: "TSU_BOT_HOST_RESULT", requestId: ev.data.requestId, success: false, error: err.message }, "*");
      }
      return;
    }

    if (type === "TSU_BOT_POST_CHAT") {
      const { messageKey, message, chatInputSelectors, chatSendSelectors, announce } = ev.data;
      try {
        await postChat(message, chatInputSelectors, chatSendSelectors, announce);
        window.postMessage({
          type: "TSU_BOT_CHAT_RESULT",
          success: true,
          messageKey,
          message,
        }, "*");
      } catch (err) {
        window.postMessage({
          type: "TSU_BOT_CHAT_RESULT",
          success: false,
          messageKey,
          error: err.message,
        }, "*");
      }
    }
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Signal content.js that we're ready
  window.postMessage({ type: "TSU_BOT_INJECTED_READY" }, "*");
  console.log("[TSU-BOT] bot-injected.js loaded");
})();
