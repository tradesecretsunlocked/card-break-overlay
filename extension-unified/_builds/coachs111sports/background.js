/**
 * TSU Whatnot Bot — background.js (MV3 Service Worker)
 *
 * Minimal service worker. Core logic lives in content.js (runs as
 * long as the Whatnot tab is open).
 *
 * Responsibilities here:
 *   - Relay messages between popup and content script (different contexts)
 *   - Badge updates (connected / idle / error state)
 */

const BADGE_STATES = {
  connected:    { text: "ON",  color: "#22c55e" },
  idle:         { text: "",    color: "#6b7280" },
  error:        { text: "ERR", color: "#ef4444" },
  disabled:     { text: "OFF", color: "#6b7280" },
};

function setBadge(state) {
  const s = BADGE_STATES[state] || BADGE_STATES.idle;
  chrome.action.setBadgeText({ text: s.text });
  chrome.action.setBadgeBackgroundColor({ color: s.color });
}

// ── Relay: popup ↔ content script ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Message FROM popup → forward to active Whatnot content script
  if (msg._from === "popup") {
    chrome.tabs.query({ url: ["https://www.whatnot.com/*"] }, (tabs) => {
      if (!tabs.length) {
        sendResponse({ ok: false, error: "No active Whatnot tab found" });
        return;
      }
      // Send to all Whatnot tabs (there may be multiple streams open)
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, msg, () => {
          // ignore sendResponse per tab — popup gets aggregate
        });
      });
      sendResponse({ ok: true, tabCount: tabs.length });
    });
    return true; // async
  }

  // Message FROM content script → badge + timed-reminder scheduling
  if (msg._from === "content") {
    if (msg.type === "bot_status") {
      setBadge(msg.state || "idle");
    }

    // The reminder schedule lives HERE, not in the page. A content-script
    // setInterval is throttled hard once the Whatnot tab goes to the background
    // (which it always does while the seller streams), so the callback only ran
    // when the page next woke up, typically on an incoming sale. chrome.alarms
    // in the service worker is not throttled that way.
    if (msg.type === "arm_reminder" && sender.tab?.id != null) {
      const name = REMINDER_PREFIX + sender.tab.id;
      reminderPresets[sender.tab.id] = msg.preset || "break_starting";
      chrome.alarms.create(name, { periodInMinutes: Math.max(1, Number(msg.periodMinutes) || 5) });
    }

    if (msg.type === "disarm_reminder" && sender.tab?.id != null) {
      chrome.alarms.clear(REMINDER_PREFIX + sender.tab.id);
      delete reminderPresets[sender.tab.id];
      clearTimersForTab(sender.tab.id);
    }

    // v2.0 — MANY scheduled messages. One alarm per timer, namespaced per tab so
    // two open shows can never double-post.
    if (msg.type === "arm_timers" && sender.tab?.id != null) {
      const tabId = sender.tab.id;
      clearTimersForTab(tabId);
      (Array.isArray(msg.timers) ? msg.timers : []).forEach((t) => {
        const id   = String(t.id || "t").replace(/[^A-Za-z0-9_-]/g, "");
        const name = TIMER_PREFIX + tabId + "__" + id;
        timerSpecs[name] = { preset: t.preset || "break_starting", text: t.text || "", timerId: id };
        chrome.alarms.create(name, { periodInMinutes: Math.max(1, Number(t.periodMinutes) || 5) });
      });
    }

    sendResponse({ ok: true });
  }
});

// ── Timed reminder alarms ────────────────────────────────────────────────────
const REMINDER_PREFIX = "tsu_reminder_";
const reminderPresets = {};

const TIMER_PREFIX = "tsu_timer_";
const timerSpecs = {};   // alarmName -> { preset, text, timerId }

function clearTimersForTab(tabId) {
  const pfx = TIMER_PREFIX + tabId + "__";
  Object.keys(timerSpecs).forEach((name) => {
    if (name.startsWith(pfx)) { chrome.alarms.clear(name); delete timerSpecs[name]; }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  // v2.0 multi-timer alarms
  if (alarm.name.startsWith(TIMER_PREFIX)) {
    const spec  = timerSpecs[alarm.name];
    const tabId = Number(alarm.name.slice(TIMER_PREFIX.length).split("__")[0]);
    if (!spec || !Number.isFinite(tabId)) return;
    chrome.tabs.sendMessage(
      tabId,
      { _from: "background", type: "timed_reminder_fire", preset: spec.preset, text: spec.text, timerId: spec.timerId },
      () => { if (chrome.runtime.lastError) { chrome.alarms.clear(alarm.name); delete timerSpecs[alarm.name]; } }
    );
    return;
  }

  if (!alarm.name.startsWith(REMINDER_PREFIX)) return;
  const tabId = Number(alarm.name.slice(REMINDER_PREFIX.length));
  if (!Number.isFinite(tabId)) return;

  // Fire into the exact tab that armed it, so two open shows cannot double post.
  chrome.tabs.sendMessage(
    tabId,
    { _from: "background", type: "timed_reminder_fire", preset: reminderPresets[tabId] },
    () => { if (chrome.runtime.lastError) chrome.alarms.clear(alarm.name); }
  );
});

// Tab closed: drop its schedule.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.alarms.clear(REMINDER_PREFIX + tabId);
  delete reminderPresets[tabId];
  clearTimersForTab(tabId);
});

// Reset badge when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  setBadge("idle");
});
