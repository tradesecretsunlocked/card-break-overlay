(() => {
  /**
   * TSU Whatnot Bot — content.js v1.0
   * ─────────────────────────────────────────────────────────────────────────────
   * Runs as a Chrome extension content script on whatnot.com live/user pages.
   *
   * WHAT THIS DOES:
   *   1. Loads per-client config from Supabase bot_configs table
   *   2. Connects to TSU bridge SSE — listens for bot_trigger events from OBS
   *   3. MutationObserver — detects giveaway widget DOM changes
   *   4. Timed reminder scheduler (break starting soon, etc.)
   *   5. Rate limiter / cooldown per message type
   *   6. Chat poster via bot-injected.js (React-aware DOM manipulation)
   *   7. Posts bot_event back to bridge so overlay can reflect bot state
   *
   * PER-CLIENT SETUP (only these differ between clients):
   *   bridgeKey     — same key used by the existing TSU Bridge extension
   *   supabaseUrl   — your project's Supabase URL (same as bridge server uses)
   *   supabaseAnonKey — Supabase anon/public key (safe to embed in extension)
   *
   * DOM SELECTORS — marked TODO: verify with DOM inspection before first deploy.
   */

  // ══════════════════════════════════════════════════════════════════════
  // 1. CONSTANTS & DEFAULTS
  // ══════════════════════════════════════════════════════════════════════

  const BRIDGE_URL = "https://bridge.tradesecretsunlocked.com";

  // CHANGE PER CLIENT — bake into extension before packaging for that client
  const DEFAULTS = {
    bridgeKey:        "e1fb8d70-9dca-4a3b-a79f-5bebada1855b",  // per-client — set in popup or bake per build
    // REQUIRED as of v1.3. The client's Whatnot handle, lowercase, no @.
    // The bot refuses to post on any show not hosted by this handle. Without it,
    // a trigger fired while the seller is watching someone else's stream would
    // post THEIR promo into SOMEONE ELSE'S chat.
    sellerUsername:   "topbidvault",
    supabaseUrl:      "https://znyryhgjghjsobkzyfbx.supabase.co",
    supabaseAnonKey:  "sb_publishable_5uKQd3y05-EkgaMZJhxpSg_14SIZC5e",  // public — safe to embed
    channel:          "main",
    botEnabled:       true,
    chatDelayMs:      1500,    // ms to wait after typing before sending
    cooldownMs:       30000,   // min ms between same message type (anti-spam)
    timedReminderMs:  0,       // 0 = disabled; set to e.g. 300000 (5 min) to auto-post
    giveawayDomEnabled: false,  // DOM giveaway detection OFF by default (selector unverified/flaky). Enable per-client via bot_configs.auto_triggers.giveaway_dom = true
  };

  // Default message presets — overridden by Supabase bot_configs.messages
  const DEFAULT_MESSAGES = {
    giveaway_started:  "🎁 GIVEAWAY IS LIVE! Scroll up and join before it closes! 🔥",
    giveaway_ended:    "🏆 Giveaway is closed! Keep an eye on the stream for the winner!",
    break_starting:    "⏰ Next break starting SOON — grab your spots before they sell out!",
    break_live:        "🔴 WE ARE LIVE! Spots going fast — don't miss out!",
    custom_1:          "",  // TODO: fill in via Supabase bot_configs or extension popup
    custom_2:          "",
    custom_3:          "",
  };

  // ── Whatnot DOM selectors ─────────────────────────────────────────────────
  // TODO: VERIFY these with a live DOM inspection before first deploy.
  // The try-first-match approach means we gracefully fallback down the list.
  // See PENDING.md for instructions on how to find the real selectors.

  // ✅ VERIFIED 2026-06-07 against a live Whatnot viewer page.
  // The chat box is a single-line <input data-testid="chat-input"> (placeholder
  // "Say something..."), NOT a textarea. First match wins.
  const CHAT_INPUT_SELECTORS = [
    "input[placeholder*='say something' i]",     // ✅ current (verified 2026-08-10; data-testid removed by Whatnot)
    "input[data-testid='chat-input']",           // legacy (pre-2026-08)
    "input[type='text'][placeholder*='message' i]",
    "[data-testid='chat-input']",
    "textarea[placeholder*='message' i]",        // legacy fallback
    "form textarea",
  ];

  // NOTE: Whatnot chat sends on ENTER — there is no dedicated send button next to
  // the input. postChat() in bot-injected.js falls back to an Enter keypress when
  // none of these match, which is the expected path. These stay as best-effort.
  const CHAT_SEND_SELECTORS = [
    "button[data-testid='chat-send']",
    "button[aria-label*='send' i]",
  ];

  // Giveaway widget selectors — any appearing = giveaway is live.
  // ⚠️ STILL UNVERIFIED: no giveaway was active during inspection. Whatnot uses
  // data-testid attributes (confirmed pattern: chat-input, desktop-chat-panel,
  // chat-message). Verify these when a giveaway is live. Bridge/manual triggers
  // work regardless of DOM auto-detection.
  const GIVEAWAY_ACTIVE_SELECTORS = [
    "[data-testid*='giveaway' i]",
    "[class*='giveaway' i]",
    "[aria-label*='giveaway' i]",
  ];

  // SSE reconnect timing
  const SSE_RECONNECT_INITIAL_MS = 3000;
  const SSE_RECONNECT_MAX_MS     = 30000;

  // ══════════════════════════════════════════════════════════════════════
  // 2. STATE
  // ══════════════════════════════════════════════════════════════════════

  let cfg           = null;   // resolved config (DEFAULTS + storage + Supabase)
  let messages      = { ...DEFAULT_MESSAGES };
  let announceFlags = {};   // messageKey -> true, from bot_configs.messages.announce
  let lastFiredAt   = {};     // { messageKey: timestamp } — cooldown tracking
  let giveawayActive = false; // true once we've announced a running giveaway
  let lastGiveawayAnnounceAt = 0; // last time ANY giveaway message was posted
  let giveawayEndTimer = null; // pending "ended" confirmation timer
  const GIVEAWAY_END_CONFIRM_MS = 60000;  // require 60s sustained inactive before announcing ended
  const GIVEAWAY_MIN_GAP_MS = 120000;     // min 2 min between any two giveaway announcements
  let sseReconnectMs = SSE_RECONNECT_INITIAL_MS;
  let injectedReady  = false;
  let botEnabled     = true;

  const log  = (...a) => console.log("[TSU-BOT]", ...a);
  const warn = (...a) => console.warn("[TSU-BOT]", ...a);

  // ══════════════════════════════════════════════════════════════════════
  // 3. INJECTED.JS BRIDGE
  // Injects bot-injected.js into the page (main world) for React DOM access
  // ══════════════════════════════════════════════════════════════════════

  function injectBotScript() {
    if (document.querySelector("script[data-tsu-bot-injected]")) return;
    const src = chrome.runtime.getURL("bot-injected.js");
    const s   = document.createElement("script");
    s.src = src;
    s.setAttribute("data-tsu-bot-injected", "1");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const { type } = ev.data || {};
    if (type === "TSU_BOT_INJECTED_READY") {
      injectedReady = true;
      log("bot-injected.js ready");
    }
    if (type === "TSU_BOT_CHAT_RESULT") {
      if (ev.data.success) log("✓ chat posted:", ev.data.message?.slice(0, 60));
      else warn("✗ chat post failed:", ev.data.error);
    }
    if (type === "TSU_BOT_GIVEAWAY_CHANGE") {
      handleGiveawayChange(ev.data.active);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 3b. SELLER OWNERSHIP (v1.3)
  // ══════════════════════════════════════════════════════════════════════

  function getLiveIdFromUrl() {
    const href = location.href;
    const m = href.match(/\/live\/([a-z0-9-]+)/i);
    if (m && m[1]) return m[1];
    const u = href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return u ? u[0] : null;
  }

  function fetchShowHost(liveId) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        reject(new Error("host lookup timed out"));
      }, 10000);
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data || {};
        if (d.type !== "TSU_BOT_HOST_RESULT" || d.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        if (d.success) resolve(String(d.username || "").trim().toLowerCase());
        else reject(new Error(d.error || "host lookup failed"));
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ type: "TSU_BOT_FETCH_HOST", requestId, liveId }, "*");
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. CONFIG LOADING
  // ══════════════════════════════════════════════════════════════════════

  async function loadConfig() {
    // Step 1: chrome.storage.sync baseline
    const stored = await new Promise((res) => chrome.storage.sync.get(DEFAULTS, res));

    cfg = {
      bridgeKey:       String(stored.bridgeKey       || DEFAULTS.bridgeKey).trim(),
      sellerUsername:  String(stored.sellerUsername  || DEFAULTS.sellerUsername || "")
                         .trim().toLowerCase().replace(/^@/, ""),
      supabaseUrl:     String(stored.supabaseUrl      || DEFAULTS.supabaseUrl).trim(),
      supabaseAnonKey: String(stored.supabaseAnonKey  || DEFAULTS.supabaseAnonKey).trim(),
      channel:         String(stored.channel          || "main").toLowerCase(),
      botEnabled:      stored.botEnabled !== false,
      chatDelayMs:     Number(stored.chatDelayMs)     || DEFAULTS.chatDelayMs,
      cooldownMs:      Number(stored.cooldownMs)      || DEFAULTS.cooldownMs,
      timedReminderMs: Number(stored.timedReminderMs) || DEFAULTS.timedReminderMs,
      // v2.0 — provisioning gate + multi-timer + viewer commands.
      // provisioned stays FALSE until a bot_configs row is found for this bridge key.
      provisioned:     false,
      timers:          [],
      commands:        [],
      commandPrefix:   "!",
    };

    botEnabled = cfg.botEnabled;

    // Step 2: Supabase override (bot_configs table)
    if (cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.bridgeKey && !cfg.bridgeKey.includes("REPLACE")) {
      await loadSupabaseConfig();
    } else {
      warn("Supabase not configured — using default messages. Set supabaseUrl + supabaseAnonKey in extension storage.");
    }

    log("Config loaded:", {
      bridgeKey: cfg.bridgeKey.slice(0, 8) + "…",
      enabled: cfg.botEnabled,
      channel: cfg.channel,
      cooldownMs: cfg.cooldownMs,
    });
  }

  async function loadSupabaseConfig() {
    try {
      const url = `${cfg.supabaseUrl}/rest/v1/bot_configs?bridge_key=eq.${encodeURIComponent(cfg.bridgeKey)}&select=*&limit=1`;
      const res = await fetch(url, {
        headers: {
          "apikey":        cfg.supabaseAnonKey,
          "Authorization": `Bearer ${cfg.supabaseAnonKey}`,
          "Content-Type":  "application/json",
        },
      });

      if (!res.ok) {
        warn("Supabase bot_configs fetch failed:", res.status);
        return;
      }

      const rows = await res.json();
      if (!rows.length) {
        // PROVISIONING GATE (v2.0): no row = this client has not bought/been granted
        // the chat bot. Stay completely dormant. The sales half of this extension
        // keeps working normally. Flip it on later by creating the bot_configs row —
        // no reinstall needed.
        cfg.provisioned = false;
        log("Chat bot not provisioned for this bridge key — bot dormant (sales/overlay unaffected).");
        return;
      }

      const row = rows[0];
      cfg.provisioned = true;

      // Seller handle now lives in the DB so it can be fixed from the portal
      // without rebuilding/reinstalling the extension. Falls back to the baked
      // DEFAULT when the column is empty.
      if (typeof row.seller_username === "string" && row.seller_username.trim()) {
        cfg.sellerUsername = row.seller_username.trim().toLowerCase().replace(/^@/, "");
      }

      // v2.0 multi-timers: [{id,label,enabled,preset,text,interval_ms}]
      cfg.timers = Array.isArray(row.timers) ? row.timers.filter(t => t && typeof t === "object") : [];
      // v2.0 viewer commands: [{id,enabled,trigger,response,cooldown_ms}]
      cfg.commands = Array.isArray(row.commands) ? row.commands.filter(c => c && typeof c === "object") : [];
      cfg.commandPrefix = (typeof row.command_prefix === "string" && row.command_prefix.trim())
        ? row.command_prefix.trim() : "!";

      // Override enabled state and timing
      if (typeof row.enabled       === "boolean") cfg.botEnabled     = row.enabled;
      if (typeof row.chat_delay_ms === "number")  cfg.chatDelayMs    = row.chat_delay_ms;
      if (typeof row.cooldown_ms   === "number")  cfg.cooldownMs     = row.cooldown_ms;

      // Override messages from JSONB column
      if (row.messages && typeof row.messages === "object") {
        const raw = { ...row.messages };

        // `announce` is a nested object, not a preset. Pull it out first so that
        // `messages` stays a flat key -> string map for every consumer below.
        announceFlags = (raw.announce && typeof raw.announce === "object" && !Array.isArray(raw.announce))
          ? { ...raw.announce }
          : {};
        delete raw.announce;

        // Defensive: ignore any other non-string value that shows up in the column.
        Object.keys(raw).forEach(k => { if (typeof raw[k] !== "string") delete raw[k]; });

        messages = { ...DEFAULT_MESSAGES, ...raw };
        log("Loaded", Object.keys(raw).length, "message presets from Supabase",
            "| announce:", Object.keys(announceFlags).filter(k => announceFlags[k]).join(", ") || "none");
      }

      // Timed reminder. The missing `else` here meant turning the reminder OFF in
      // the portal never cleared it, so it kept running with the old interval.
      const tr = row.auto_triggers?.timed_reminder;
      if (tr?.enabled) {
        cfg.timedReminderMs   = tr.interval_ms || 0;
        cfg.timedReminderPreset = String(tr.preset || "break_starting");
      } else {
        cfg.timedReminderMs   = 0;
        cfg.timedReminderPreset = "break_starting";
      }

      // DOM giveaway detection — only when explicitly enabled (selector is flaky)
      cfg.giveawayDomEnabled = (row.auto_triggers && typeof row.auto_triggers.giveaway_dom === "boolean")
        ? row.auto_triggers.giveaway_dom
        : DEFAULTS.giveawayDomEnabled;

      botEnabled = cfg.botEnabled;
      log("Supabase bot_configs applied:", {
        enabled: cfg.botEnabled,
        chatDelayMs: cfg.chatDelayMs,
        cooldownMs: cfg.cooldownMs,
      });

    } catch (err) {
      warn("Supabase bot_configs error:", err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. RATE LIMITER / COOLDOWN
  // ══════════════════════════════════════════════════════════════════════

  function isOnCooldown(key) {
    const last = lastFiredAt[key] || 0;
    return Date.now() - last < cfg.cooldownMs;
  }

  function markFired(key) {
    lastFiredAt[key] = Date.now();
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. CHAT POSTER
  // Posts a message to Whatnot chat via the page-context injected script.
  // ══════════════════════════════════════════════════════════════════════

  async function postChatMessage(messageKey, overrideText = null) {
    if (!botEnabled) {
      log("Bot is disabled — skipping", messageKey);
      return false;
    }

    const text = overrideText || messages[messageKey] || "";
    if (!text.trim()) {
      warn(`No message configured for key "${messageKey}" — skipping`);
      return false;
    }

    if (isOnCooldown(messageKey)) {
      log(`Cooldown active for "${messageKey}" (${Math.round((cfg.cooldownMs - (Date.now() - lastFiredAt[messageKey])) / 1000)}s remaining)`);
      return false;
    }

    // Wait for injected.js to be ready
    let waited = 0;
    while (!injectedReady && waited < 5000) {
      await sleep(200);
      waited += 200;
    }
    if (!injectedReady) {
      warn("bot-injected.js not ready — cannot post to chat");
      return false;
    }

    // Small natural delay before posting (avoid instant bot feel)
    await sleep(cfg.chatDelayMs);

    window.postMessage({
      type:       "TSU_BOT_POST_CHAT",
      messageKey,
      message:    text,
      announce:   !!announceFlags[messageKey],
      chatInputSelectors:  CHAT_INPUT_SELECTORS,
      chatSendSelectors:   CHAT_SEND_SELECTORS,
    }, "*");

    markFired(messageKey);

    // Also broadcast bot_event to bridge so overlay can reflect it
    notifyBridge({ type: "bot_event", trigger: messageKey, ts: Date.now() });

    return true;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. BRIDGE NOTIFICATION (bot → bridge → overlay)
  // Posts non-critical fire-and-forget events back to the bridge.
  // This lets the overlay show a "bot active" indicator if desired.
  // ══════════════════════════════════════════════════════════════════════

  async function notifyBridge(payload) {
    if (!cfg?.bridgeKey || cfg.bridgeKey.includes("REPLACE")) return;
    try {
      await fetch(`${BRIDGE_URL}/events`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "x-bridge-key":  cfg.bridgeKey,
          "x-api-key":     cfg.bridgeKey,
        },
        body: JSON.stringify({
          channel: cfg.channel,
          ...payload,
        }),
      });
    } catch (_) {
      // Non-critical — don't let bridge errors block chat posting
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 8. BRIDGE SSE — listen for bot_trigger events from OBS / control panel
  // ══════════════════════════════════════════════════════════════════════

  function connectSSE() {
    if (!cfg.bridgeKey || cfg.bridgeKey.includes("REPLACE")) {
      warn("bridgeKey not configured — SSE not started");
      updateBadge("error");
      return;
    }

    const url = `${BRIDGE_URL}/stream?channel=${cfg.channel}&key=${cfg.bridgeKey}`;
    log("SSE connecting:", url.replace(cfg.bridgeKey, cfg.bridgeKey.slice(0, 8) + "…"));

    const es = new EventSource(url);

    es.onopen = () => {
      log("SSE connected");
      sseReconnectMs = SSE_RECONNECT_INITIAL_MS;
      updateBadge("connected");
    };

    es.onmessage = (ev) => {
      let payload;
      try { payload = JSON.parse(ev.data); } catch (_) { return; }

      const { type } = payload;

      if (type === "hello") {
        log("SSE hello — bridge channel ready");
        return;
      }

      // ── bot_trigger: fired from OBS control panel or bridge REST POST ──
      if (type === "bot_trigger") {
        const preset = payload.preset || "";
        const text   = payload.text   || "";  // optional direct text override

        log(`bot_trigger received: preset="${preset}" text="${text.slice(0, 40)}"`);

        if (text) {
          // Direct text override — post as-is, use preset as the cooldown key
          postChatMessage(preset || "custom_direct", text);
        } else if (preset && messages[preset] !== undefined) {
          postChatMessage(preset);
        } else {
          warn(`Unknown preset "${preset}" — ignoring. Valid presets:`, Object.keys(messages).join(", "));
        }
      }

      // ── giveaway_started / giveaway_ended: can also come from bridge ──
      if (type === "giveaway_started") handleGiveawayChange(true);
      if (type === "giveaway_ended")   handleGiveawayChange(false);

      // ── bot_config_reload: Supabase config updated — re-fetch ──
      if (type === "bot_config_reload") {
        log("Config reload requested via bridge");
        loadSupabaseConfig().then(() => {
          syncTimedReminder();   // pick up an enable/disable/interval/preset change live
          log("Config reloaded");
        });
      }
    };

    es.onerror = () => {
      warn(`SSE error — reconnecting in ${sseReconnectMs / 1000}s`);
      updateBadge("error");
      es.close();
      setTimeout(() => {
        sseReconnectMs = Math.min(sseReconnectMs * 1.5, SSE_RECONNECT_MAX_MS);
        connectSSE();
      }, sseReconnectMs);
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 9. GIVEAWAY HANDLER
  // Called by both DOM observer and bridge SSE
  // ══════════════════════════════════════════════════════════════════════

  function handleGiveawayChange(isNowActive) {
    // Robust state machine — immune to a flapping detector.
    // Announce "started" once; only announce "ended" after sustained inactivity
    // (GIVEAWAY_END_CONFIRM_MS). Hard min-gap between any two announcements.
    if (isNowActive) {
      if (giveawayEndTimer) { clearTimeout(giveawayEndTimer); giveawayEndTimer = null; } // cancel pending end
      if (giveawayActive) return; // already running
      if (Date.now() - lastGiveawayAnnounceAt < GIVEAWAY_MIN_GAP_MS) { giveawayActive = true; return; }
      giveawayActive = true;
      lastGiveawayAnnounceAt = Date.now();
      log("Giveaway STARTED — firing giveaway_started");
      postChatMessage("giveaway_started");
    } else {
      if (!giveawayActive) return;  // nothing running
      if (giveawayEndTimer) return; // end already pending
      giveawayEndTimer = setTimeout(() => {
        giveawayEndTimer = null;
        if (!giveawayActive) return;
        giveawayActive = false;
        lastGiveawayAnnounceAt = Date.now();
        log("Giveaway ENDED — firing giveaway_ended");
        postChatMessage("giveaway_ended");
      }, GIVEAWAY_END_CONFIRM_MS);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 10. DOM MUTATIONOBSERVER — giveaway widget detection
  // Watches for giveaway container elements appearing in the Whatnot UI.
  //
  // TODO: After verifying selectors in PENDING.md step 1, update
  // GIVEAWAY_ACTIVE_SELECTORS at the top of this file with the real values.
  // ══════════════════════════════════════════════════════════════════════

  function findGiveawayElement() {
    for (const sel of GIVEAWAY_ACTIVE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function setupGiveawayObserver() {
    if (cfg.giveawayDomEnabled !== true) {
      log("Giveaway DOM detection disabled — using bridge/manual giveaway triggers only");
      return;
    }
    let debounceTimer = null;

    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const el = findGiveawayElement();
        const nowActive = !!el;
        if (nowActive !== giveawayActive) {
          log("DOM: giveaway element", nowActive ? "appeared" : "disappeared");
          handleGiveawayChange(nowActive);
        }
      }, 500); // debounce 500ms — avoids firing during DOM churn
    });

    observer.observe(document.body, {
      childList: true,
      subtree:   true,
      attributes: true,
      attributeFilter: ["class", "data-testid", "aria-label"],
    });

    log("Giveaway DOM observer started");
  }

  // ══════════════════════════════════════════════════════════════════════
  // 11. TIMED REMINDER SCHEDULER
  // Fires break_starting message on a repeating interval if configured.
  // Set timedReminderMs > 0 in Supabase bot_configs to enable.
  // ══════════════════════════════════════════════════════════════════════

  // v1.3.1 TIMED REMINDER — rebuilt. The old version had four defects:
  //   1. It ran ONCE at boot, so enabling the reminder from the portal did
  //      nothing until the seller reloaded the Whatnot tab.
  //   2. It hardcoded "break_starting" and ignored the preset you picked.
  //   3. Turning it off never stopped it: cfg.timedReminderMs was only ever
  //      assigned when enabled was true, and the interval handle was thrown away.
  //   4. It used setInterval on a page that is usually a BACKGROUND tab while the
  //      seller streams. Chrome throttles background timers hard and runs the
  //      queued callback only when the page next processes a task, which is when
  //      Whatnot pushes something like a sale. That is why the reminder appeared
  //      to fire on sales instead of on the clock.
  // Now the schedule lives in the MV3 service worker via chrome.alarms, which is
  // not subject to background-tab throttling, and it is re-armed on every config
  // reload so the portal toggle takes effect immediately.

  function syncTimedReminder() {
    // v2.0: supports MANY scheduled messages (cfg.timers). Falls back to the
    // legacy single auto_triggers.timed_reminder when timers[] is empty, so
    // older configs keep working untouched.
    let list = [];

    if (Array.isArray(cfg.timers) && cfg.timers.length) {
      list = cfg.timers
        .filter(t => t && t.enabled !== false)
        .map((t, i) => ({
          id:            String(t.id || ("t" + (i + 1))),
          preset:        String(t.preset || "break_starting"),
          text:          typeof t.text === "string" ? t.text : "",
          periodMinutes: Math.max(1, (Number(t.interval_ms) || 300000) / 60000),
        }));
    } else if (Number(cfg.timedReminderMs) > 0) {
      list = [{
        id:            "legacy",
        preset:        cfg.timedReminderPreset || "break_starting",
        text:          "",
        periodMinutes: Math.max(1, Number(cfg.timedReminderMs) / 60000),
      }];
    }

    if (!botEnabled || !list.length) {
      chrome.runtime.sendMessage({ _from: "content", type: "disarm_reminder" }).catch(() => {});
      log("Timed messages: OFF");
      return;
    }

    chrome.runtime.sendMessage({ _from: "content", type: "arm_timers", timers: list }).catch(() => {});
    log("Timed messages armed:", list.map(t => `${t.id}@${t.periodMinutes}min`).join(", "));
  }

  // Kept under the old name so the boot sequence reads the same.
  function setupTimedReminders() { syncTimedReminder(); }

  // ══════════════════════════════════════════════════════════════════════
  // 11b. VIEWER CHAT COMMANDS (v2.0)
  // A viewer types e.g. "!socials" and the bot replies with configured text.
  // Whatnot's chat DOM is NOT stable (they removed data-testid from the chat
  // input in Aug 2026), so this deliberately does not depend on one selector:
  // it watches the chat panel when it can find one, otherwise document.body,
  // and reads text. Per-command cooldown prevents spam and re-triggering.
  // ══════════════════════════════════════════════════════════════════════

  const CHAT_PANEL_SELECTORS = [
    "[data-testid='desktop-chat-panel']",
    "[data-testid*='chat-panel' i]",
    "[class*='chat-panel' i]",
    "[class*='chatPanel' i]",
  ];

  const cmdLastFired = {};      // trigger -> timestamp
  const recentlyPosted = [];    // guard so the bot never answers itself
  let cmdObserver = null;

  function noteOutbound(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return;
    recentlyPosted.push(t);
    if (recentlyPosted.length > 12) recentlyPosted.shift();
  }

  function findChatPanel() {
    for (const sel of CHAT_PANEL_SELECTORS) {
      try { const el = document.querySelector(sel); if (el) return el; } catch (_) {}
    }
    // Fallback: walk up from the chat input to a container that plausibly holds
    // the message list. Chat volume is low enough that body-observing is safe.
    for (const sel of CHAT_INPUT_SELECTORS) {
      try {
        const input = document.querySelector(sel);
        if (input) {
          let n = input.parentElement;
          for (let i = 0; i < 6 && n; i++) { n = n.parentElement; }
          if (n) return n;
        }
      } catch (_) {}
    }
    return document.body;
  }

  function activeCommands() {
    return (Array.isArray(cfg.commands) ? cfg.commands : [])
      .filter(c => c && c.enabled !== false && String(c.trigger || "").trim() && String(c.response || "").trim());
  }

  function handleChatText(rawText) {
    const text = String(rawText || "").trim();
    if (!text || text.length > 400) return;
    const low = text.toLowerCase();

    // Never react to our own posts.
    for (const p of recentlyPosted) { if (p && low.includes(p.slice(0, 40))) return; }

    const prefix = String(cfg.commandPrefix || "!");
    for (const c of activeCommands()) {
      let trig = String(c.trigger).trim().toLowerCase();
      if (!trig.startsWith(prefix.toLowerCase())) trig = prefix.toLowerCase() + trig;

      // Word-boundary-ish match so "!socialsxyz" does not fire "!socials".
      const idx = low.indexOf(trig);
      if (idx === -1) continue;
      const after = low.charAt(idx + trig.length);
      if (after && /[a-z0-9_]/.test(after)) continue;

      const cd   = Number(c.cooldown_ms) || 30000;
      const last = cmdLastFired[trig] || 0;
      if (Date.now() - last < cd) return;
      cmdLastFired[trig] = Date.now();

      log(`Command "${trig}" triggered — replying.`);
      noteOutbound(c.response);
      postChatMessage("cmd_" + trig.replace(/[^a-z0-9]+/g, "_"), String(c.response));
      return; // one command per message
    }
  }

  function setupCommandWatcher() {
    if (!activeCommands().length) { log("Viewer commands: none configured"); return; }
    if (cmdObserver) { try { cmdObserver.disconnect(); } catch (_) {} }

    const panel = findChatPanel();
    cmdObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!node) continue;
          const txt = node.nodeType === 3 ? node.textContent : (node.innerText || node.textContent);
          if (txt) handleChatText(txt);
        }
      }
    });
    cmdObserver.observe(panel, { childList: true, subtree: true });
    log(`Viewer commands active (${activeCommands().length}): ` +
        activeCommands().map(c => String(c.trigger)).join(", ") +
        (panel === document.body ? " [watching body — chat panel not matched]" : ""));
  }

  // ══════════════════════════════════════════════════════════════════════
  // 12. POPUP / BACKGROUND MESSAGE RELAY
  // Receives commands from the extension popup
  // ══════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg._from !== "popup") return;

    switch (msg.action) {
      case "fire_preset":
        postChatMessage(msg.preset, msg.text || null).then((ok) => {
          sendResponse({ ok, preset: msg.preset });
        });
        return true; // async

      case "get_status":
        sendResponse({
          ok: true,
          enabled:        botEnabled,
          giveawayActive,
          configuredKey:  cfg?.bridgeKey?.slice(0, 8) + "…",
          channel:        cfg?.channel,
          messageKeys:    Object.keys(messages).filter(k => !!messages[k]),
          lastFiredAt,
        });
        return false;

      case "timed_reminder_fire":
        if (botEnabled) {
          // A timer may carry literal text (custom scheduled message) or a preset key.
          if (msg.text && String(msg.text).trim()) {
            postChatMessage(String(msg.timerId || "timer"), String(msg.text));
          } else {
            postChatMessage(msg.preset || cfg.timedReminderPreset || "break_starting");
          }
        }
        sendResponse({ ok: true });
        return false;

      case "toggle_bot":
        botEnabled = !!msg.enabled;
        cfg.botEnabled = botEnabled;
        chrome.storage.sync.set({ botEnabled });
        updateBadge(botEnabled ? "connected" : "disabled");
        sendResponse({ ok: true, enabled: botEnabled });
        return false;

      case "reload_config":
        loadSupabaseConfig().then(() => sendResponse({ ok: true }));
        return true;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 13. BADGE / STATUS UPDATE
  // ══════════════════════════════════════════════════════════════════════

  function updateBadge(state) {
    chrome.runtime.sendMessage({ _from: "content", type: "bot_status", state }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════════
  // 14. UTILITIES
  // ══════════════════════════════════════════════════════════════════════

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ══════════════════════════════════════════════════════════════════════
  // 15. INIT
  // ══════════════════════════════════════════════════════════════════════

  (async () => {
    log("Starting TSU Whatnot Bot v1.2");

    // Inject page-context script for React DOM access
    injectBotScript();

    // Wait for page to be interactive
    await sleep(1000);

    // Load config from storage + Supabase
    await loadConfig();

    // ══ v2.0 PROVISIONING GATE ════════════════════════════════════════════
    // This extension ships to EVERY client (sales + chat bot in one package).
    // The chat bot half only wakes up when the client actually has a
    // bot_configs row (i.e. they are provisioned for the chatbot service).
    // No row -> silent, dormant, zero side effects. Granting the bot later is
    // a database change only: NO reinstall, NO new extension.
    if (!cfg.provisioned) {
      updateBadge("idle");
      return;
    }

    if (!cfg.botEnabled) {
      warn("Bot is disabled via config — set botEnabled=true in Supabase or extension storage to enable");
      updateBadge("disabled");
      return;
    }

    if (!cfg.bridgeKey || cfg.bridgeKey.includes("REPLACE")) {
      warn("bridgeKey not set! Open the extension popup and enter the client's bridge key, or bake it into DEFAULTS in content.js before packaging.");
      updateBadge("error");
      return;
    }

    // ══ v1.3 SELLER OWNERSHIP GATE ═════════════════════════════════════
    // Fail CLOSED. Posting the client's promo into another seller's chat is
    // worse than the bot staying quiet.
    if (!cfg.sellerUsername || cfg.sellerUsername.includes("replace")) {
      warn("sellerUsername not set. The bot will NOT post.\n" +
           "Bake DEFAULTS.sellerUsername (the client's Whatnot handle, lowercase, no @) and reload.");
      updateBadge("error");
      return;
    }

    const liveId = getLiveIdFromUrl();
    if (!liveId) {
      log("Not a live show page — bot idle here. Nothing to post into.");
      updateBadge("idle");
      return;
    }

    let showHost = null;
    try {
      showHost = await fetchShowHost(liveId);
    } catch (err) {
      warn("Could not confirm who hosts this show (" + (err && err.message) + "). Not posting, for safety.");
      updateBadge("error");
      return;
    }

    if (!showHost) {
      warn("Show host came back empty. Not posting, for safety.");
      updateBadge("error");
      return;
    }

    if (showHost !== cfg.sellerUsername) {
      log("This show belongs to @" + showHost + ", not @" + cfg.sellerUsername +
          ". Bot stays quiet. You can watch other sellers without your messages posting to their chat.");
      updateBadge("idle");
      return;
    }

    log("Host verified: @" + showHost + " — bot armed.");

    // Start all subsystems
    // setupGiveawayObserver();  // DOM detection disabled — network detector in bot-injected.js is primary
    connectSSE();
    setupTimedReminders();
    setupCommandWatcher();

    log("Bot running ✓  key:", cfg.bridgeKey.slice(0, 8) + "…  channel:", cfg.channel);
    log("Active message presets:", Object.keys(messages).filter(k => !!messages[k]).join(", "));

    updateBadge("connected");
  })();

})();
