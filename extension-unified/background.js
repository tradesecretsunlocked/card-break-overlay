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
      setReminderPreset(sender.tab.id, msg.preset || "break_starting");
      chrome.alarms.create(name, { periodInMinutes: Math.max(1, Number(msg.periodMinutes) || 5) });
    }

    if (msg.type === "disarm_reminder" && sender.tab?.id != null) {
      chrome.alarms.clear(REMINDER_PREFIX + sender.tab.id);
      dropReminderPreset(sender.tab.id);
      clearTimersForTab(sender.tab.id);
    }

    // v2.0 — MANY scheduled messages. One alarm per timer, namespaced per tab so
    // two open shows can never double-post.
    if (msg.type === "arm_timers" && sender.tab?.id != null) {
      const tabId = sender.tab.id;
      const list  = Array.isArray(msg.timers) ? msg.timers : [];
      /* Sequenced: clearTimersForTab() and setTimerSpec() both read-modify-write
         the same stored map, so firing them off in parallel would let the clear
         land last and wipe the specs we just wrote. */
      (async () => {
        await clearTimersForTab(tabId);
        for (const t of list){
          const id   = String(t.id || "t").replace(/[^A-Za-z0-9_-]/g, "");
          const name = TIMER_PREFIX + tabId + "__" + id;
          await setTimerSpec(name, { preset: t.preset || "break_starting", text: t.text || "", timerId: id });
          chrome.alarms.create(name, { periodInMinutes: Math.max(1, Number(t.periodMinutes) || 5) });
        }
        console.log("[TSU] armed " + list.length + " timer(s) for tab " + tabId +
                    ": " + list.map(t => (t.id || "?") + "@" + t.periodMinutes + "min").join(", "));
      })();
    }

    sendResponse({ ok: true });
  }
});

// ── Timed reminder alarms ────────────────────────────────────────────────────
const REMINDER_PREFIX = "tsu_reminder_";
const TIMER_PREFIX    = "tsu_timer_";

/* ═══════════════════════════════════════════════════════════════════════════
   2026-09-21 CRITICAL FIX — timed messages never fired.

   `timerSpecs` and `reminderPresets` were plain module-level objects. This is an
   MV3 SERVICE WORKER: Chrome terminates it after ~30 seconds idle and restarts
   it fresh when an event arrives. Module state does NOT survive that.

   So the sequence was always:
     1. content.js arms a 2-minute alarm, spec written to memory  ✓
     2. ~30s later Chrome kills the idle service worker, memory gone
     3. at 2 minutes the alarm fires and WAKES the worker — but `timerSpecs` is
        now `{}`, so `if (!spec) return;` bailed out silently
   The alarm was firing correctly the whole time. The payload to send with it had
   evaporated. Net effect: scheduled messages could only ever work if the alarm
   happened to land while the worker was still warm, which is almost never on a
   2+ minute interval. Zero log lines, zero bridge events — indistinguishable
   from "the timer never armed".

   Fix: keep the specs in chrome.storage.session, which is exactly what it is for
   — service-worker-restart-safe, cleared when the browser closes (which is the
   right lifetime, since the alarms are tab-scoped and tabs do not outlive the
   browser either). The in-memory object stays as a fast path, but storage is the
   source of truth and is always consulted on a miss.
   ═══════════════════════════════════════════════════════════════════════════ */

const SPECS_KEY     = "tsu.timerSpecs";
const REMINDERS_KEY = "tsu.reminderPresets";

/* storage.session needs Chrome 102+. Fall back to storage.local so an older
   build degrades to "works but survives a browser restart" instead of breaking. */
const sessionStore = (chrome.storage && chrome.storage.session) || chrome.storage.local;

async function readMap(key){
  try{ const o = await sessionStore.get(key); return (o && o[key]) || {}; }
  catch(_){ return {}; }
}
async function writeMap(key, map){
  try{ await sessionStore.set({ [key]: map }); }catch(_){}
}

let timerSpecs     = {};   // alarmName -> { preset, text, timerId }   (cache only)
let reminderPresets = {};  // tabId     -> preset                       (cache only)

async function setTimerSpec(name, spec){
  const map = await readMap(SPECS_KEY);
  map[name] = spec;
  timerSpecs = map;
  await writeMap(SPECS_KEY, map);
}
async function setReminderPreset(tabId, preset){
  const map = await readMap(REMINDERS_KEY);
  map[tabId] = preset;
  reminderPresets = map;
  await writeMap(REMINDERS_KEY, map);
}
async function dropReminderPreset(tabId){
  const map = await readMap(REMINDERS_KEY);
  delete map[tabId];
  reminderPresets = map;
  await writeMap(REMINDERS_KEY, map);
}

async function clearTimersForTab(tabId) {
  const pfx = TIMER_PREFIX + tabId + "__";
  const map = await readMap(SPECS_KEY);
  for (const name of Object.keys(map)){
    if (name.startsWith(pfx)) { chrome.alarms.clear(name); delete map[name]; }
  }
  timerSpecs = map;
  await writeMap(SPECS_KEY, map);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // v2.0 multi-timer alarms
  if (alarm.name.startsWith(TIMER_PREFIX)) {
    const map   = await readMap(SPECS_KEY);          // survives worker restarts
    const spec  = map[alarm.name] || timerSpecs[alarm.name];
    const tabId = Number(alarm.name.slice(TIMER_PREFIX.length).split("__")[0]);
    if (!spec || !Number.isFinite(tabId)) {
      /* Genuinely orphaned (tab gone, or armed before this fix shipped). Clear it
         so it stops waking the worker for nothing — and SAY so, because the old
         silent return is what made this invisible for weeks. */
      console.warn("[TSU] timer alarm with no stored spec, clearing:", alarm.name);
      chrome.alarms.clear(alarm.name);
      return;
    }
    chrome.tabs.sendMessage(
      tabId,
      { _from: "background", type: "timed_reminder_fire", preset: spec.preset, text: spec.text, timerId: spec.timerId },
      () => {
        if (chrome.runtime.lastError) {
          chrome.alarms.clear(alarm.name);
          delete map[alarm.name];
          timerSpecs = map;
          writeMap(SPECS_KEY, map);
        }
      }
    );
    return;
  }

  if (!alarm.name.startsWith(REMINDER_PREFIX)) return;
  const tabId = Number(alarm.name.slice(REMINDER_PREFIX.length));
  if (!Number.isFinite(tabId)) return;

  const rmap = await readMap(REMINDERS_KEY);
  const preset = rmap[tabId] || reminderPresets[tabId] || "break_starting";

  // Fire into the exact tab that armed it, so two open shows cannot double post.
  chrome.tabs.sendMessage(
    tabId,
    { _from: "background", type: "timed_reminder_fire", preset },
    () => { if (chrome.runtime.lastError) chrome.alarms.clear(alarm.name); }
  );
});

// Tab closed: drop its schedule.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.alarms.clear(REMINDER_PREFIX + tabId);
  dropReminderPreset(tabId);
  clearTimersForTab(tabId);
});

// Reset badge when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  setBadge("idle");
});
