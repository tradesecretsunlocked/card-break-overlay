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

  /* ═══════════════════════════════════════════════════════════════════════
     2026-09-21 ROOT CAUSE FIX — "types into the box but never sends".

     Proven from a live bot_error on the seller dashboard:
       matchedInput   input[type=text][ph=Say something...]   (selector was fine)
       hasForm        true
       hadSendButton  false
       error          SEND_NOT_FIRED

     So the input was found and filled, then Enter, form.requestSubmit() and a
     second Enter all did nothing. requestSubmit() is a REAL native submit — if
     React had a message in state it would have sent. It follows that React's
     state was still EMPTY and the send handler was bailing on an empty message,
     while the DOM kept our text because React was not re-rendering the field.

     Why: React keeps a `_valueTracker` on controlled inputs to decide whether an
     input event is a real change. Writing through the prototype's native setter
     mutates the DOM but leaves the tracker holding the OLD value, and in that
     state React can swallow the synthetic input event and never update state.
     The previous code never touched the tracker.

     Fix, most-native first:
       1. document.execCommand("insertText") — drives Chromium's real editing
          pipeline, so React sees a genuine beforeinput/input sequence. This is
          what a human typing actually produces.
       2. Native setter WITH an explicit tracker reset, which forces React to
          treat the next input event as a change.
     Returns which path was used so it lands in the diagnostics. */
  function setReactInputValue(element, value) {
    element.focus();

    // ── 1. the native editing pipeline ──────────────────────────────────────
    try {
      element.select && element.select();
      if (document.execCommand("insertText", false, value) && element.value === value) {
        return "execCommand";
      }
    } catch (_) {}

    // ── 2. native setter + value tracker reset ──────────────────────────────
    const proto = element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

    const previous   = element.value;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (!descriptor || !descriptor.set) element.value = value;
    else descriptor.set.call(element, value);

    /* THE LINE THAT WAS MISSING. Rewind React's tracker to the pre-change value
       so the input event below cannot be deduped away as "nothing changed". */
    try {
      const tracker = element._valueTracker;
      if (tracker && typeof tracker.setValue === "function") tracker.setValue(previous);
    } catch (_) {}

    element.dispatchEvent(new InputEvent("input", {
      bubbles: true, cancelable: true, inputType: "insertText", data: value,
    }));
    element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    return "nativeSetter";
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
      /* 2026-09-21: dump what IS on the page so a miss is diagnosable remotely
         instead of needing someone to sit in the console. */
      let seen = [];
      try {
        seen = Array.from(document.querySelectorAll("input,textarea"))
          .slice(0, 12)
          .map(el => (el.tagName.toLowerCase()
                   + (el.type ? "[type=" + el.type + "]" : "")
                   + (el.placeholder ? "[ph=" + el.placeholder.slice(0,40) + "]" : "")
                   + (el.getAttribute("data-testid") ? "[tid=" + el.getAttribute("data-testid") + "]" : "")));
      } catch (_) {}
      const err = new Error("CHAT_INPUT_NOT_FOUND: none of the selectors matched on " + location.pathname);
      err.tsuDiag = { stage: "find_input", tried: chatInputSelectors, inputsOnPage: seen, url: location.href };
      throw err;
    }

    // 2. Focus the input
    input.focus();
    await delay(100);

    // 3. Set the message (React-aware)
    const setVia = setReactInputValue(input, outbound);
    await delay(150);

    // 4. Submit. Whatnot chat is a single-line input that sends on Enter (no send
    //    button). Setting the value alone never submits, so escalate through:
    //    send button -> full Enter key sequence -> surrounding form submit.
    await delay(60);

    let via = null;
    const sendBtn = findElement(chatSendSelectors);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click(); via = "send_button";
    } else {
      fireEnter(input); via = "enter";
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
      if (input.value !== outbound) via = "form_submit";
    }
    if (input.value === outbound) {
      // Escalate 2: one more full Enter sequence directly on the focused input.
      input.focus();
      fireEnter(input);
      await delay(200);
      if (input.value !== outbound) via = "enter_retry";
    }

    // Honest result: if our text is STILL sitting in the box, the send never fired.
    // Report it as a real failure instead of a false "posted".
    if (input.value === outbound) {
      const err = new Error("SEND_NOT_FIRED: the text WAS placed in the chat box but nothing sent it. Whatnot ignored the send button, Enter, and form submit.");
      err.tsuDiag = {
        stage: "send",
        setVia: setVia,
        matchedInput: input.tagName.toLowerCase()
                    + (input.type ? "[type=" + input.type + "]" : "")
                    + (input.placeholder ? "[ph=" + input.placeholder.slice(0,40) + "]" : ""),
        hadSendButton: !!sendBtn,
        hasForm: !!(input.form || (input.closest && input.closest("form"))),
        isConnected: input.isConnected,
        url: location.href,
      };
      throw err;
    }
    return via;
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
  /* Only these count as "a giveaway is RUNNING". Deliberately narrow — see the
     false-positive note in _tsuEvaluateGiveaway. */
  const GIVEAWAY_STARTED_STATUSES = new Set(["active","live","running","started","open","in_progress"]);
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
      const status = String(g.status || "").toLowerCase();
      const ended = GIVEAWAY_ENDED_STATUSES.has(status);
      if (!ended){
        /* 2026-09-21 FALSE-POSITIVE FIX. Four live bot_giveaway_signal events all
           came through here with source=graphql_listing, fired by merely OPENING
           the giveaway tab — which loads GIVEAWAY listings that are not running.
           "Not ended" is NOT the same as "started": a listing the seller has only
           drafted or is looking at also fails the ended test. Require POSITIVE
           evidence of a running giveaway. The analytics signal
           (seller_sees_giveaway_started) remains the trusted start trigger.
           Unknown statuses are reported, not acted on, so the allow-list can be
           completed from real data instead of another guess. */
        if (!GIVEAWAY_STARTED_STATUSES.has(status)){
          window.postMessage({ type: "TSU_BOT_GIVEAWAY_OBSERVED",
                               status: status || "(none)", gid }, "*");
          continue;
        }
        if (!giveawayNetActive || (gid && _tsuActiveGiveawayId !== gid)){
          giveawayNetActive = true; _tsuActiveGiveawayId = gid;
          window.postMessage({ type: "TSU_BOT_GIVEAWAY_CHANGE", active: true, source: "graphql_status:" + status }, "*");
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
      /* 2026-09-21: these three names were assumed to mean "a giveaway started".
         Field report says merely OPENING the giveaway tab fires one of them, so at
         least one fires on panel-open, not on start. Capture WHICH name matched and
         ship it with the event so the pattern can be narrowed from real data rather
         than guessed at a third time. */
      const m = txt && String(txt).match(/seller_sees_giveaway_started|story_start_giveaway|seller_taps_start_giveaway/i);
      if (m){
        if (!giveawayNetActive){
          giveawayNetActive = true;
          window.postMessage({ type: "TSU_BOT_GIVEAWAY_CHANGE", active: true, source: "analytics:" + m[0] }, "*");
        }
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
        const via = await postChat(message, chatInputSelectors, chatSendSelectors, announce);
        window.postMessage({
          type: "TSU_BOT_CHAT_RESULT",
          success: true,
          messageKey,
          message,
          via,
        }, "*");
      } catch (err) {
        window.postMessage({
          type: "TSU_BOT_CHAT_RESULT",
          success: false,
          messageKey,
          error: err.message,
          diag: err.tsuDiag || null,
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
