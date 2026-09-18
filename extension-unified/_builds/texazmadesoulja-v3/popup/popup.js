/**
 * TSU Whatnot Bot — popup.js
 * Extension popup controller
 */

const $ = (id) => document.getElementById(id);

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, isError = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 2000);
}

// ── Get status from content script ───────────────────────────────────────────
function sendToContent(action, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { _from: "popup", action, ...extra },
      (resp) => resolve(resp || { ok: false })
    );
  });
}

async function refreshStatus() {
  const status = await sendToContent("get_status");

  const dot  = $("status-dot");
  const text = $("status-text");
  const keyDisplay = $("key-display");

  if (!status || !status.ok) {
    dot.className  = "status-dot error";
    text.textContent = "No active Whatnot tab";
    return;
  }

  dot.className  = "status-dot " + (status.enabled ? "connected" : "disabled");
  text.textContent = status.enabled
    ? `Connected · ch: ${status.channel || "main"}`
    : "Disabled";

  keyDisplay.textContent = status.configuredKey || "—";

  // Update toggle
  $("bot-toggle").checked = !!status.enabled;

  // Update cooldown badges
  const now = Date.now();
  Object.entries(status.lastFiredAt || {}).forEach(([key, ts]) => {
    const badge = document.querySelector(`[data-key="${key}"]`);
    if (!badge) return;
    const remaining = Math.max(0, 30000 - (now - ts));
    badge.textContent = remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : "—";
  });
}

// ── Bot toggle ────────────────────────────────────────────────────────────────
$("bot-toggle").addEventListener("change", async (e) => {
  const result = await sendToContent("toggle_bot", { enabled: e.target.checked });
  if (result.ok) {
    showToast(e.target.checked ? "Bot enabled" : "Bot disabled");
    refreshStatus();
  }
});

// ── Preset buttons ────────────────────────────────────────────────────────────
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const preset = btn.dataset.preset;
    btn.disabled = true;

    const result = await sendToContent("fire_preset", { preset });

    if (result?.ok) {
      btn.classList.add("fired");
      showToast(`Fired: ${preset}`);
      setTimeout(() => { btn.classList.remove("fired"); btn.disabled = false; }, 3000);
    } else {
      showToast(result?.error || "Failed — check Whatnot tab console", true);
      btn.disabled = false;
    }
    refreshStatus();
  });
});

// ── Custom message send ───────────────────────────────────────────────────────
$("send-custom-btn").addEventListener("click", async () => {
  const text = $("custom-text").value.trim();
  if (!text) { showToast("Enter a message first", true); return; }

  $("send-custom-btn").disabled = true;
  $("send-custom-btn").textContent = "…";

  const result = await sendToContent("fire_preset", { preset: "custom_direct", text });

  $("send-custom-btn").disabled = false;
  $("send-custom-btn").textContent = "Send";

  if (result?.ok) {
    showToast("Sent!");
    $("custom-text").value = "";
  } else {
    showToast("Failed — check Whatnot tab console", true);
  }
});

$("custom-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("send-custom-btn").click();
});

// ── Config tab: load existing values ─────────────────────────────────────────
async function loadConfigFields() {
  const stored = await new Promise((res) =>
    chrome.storage.sync.get(["bridgeKey", "supabaseUrl", "supabaseAnonKey", "cooldownMs"], res)
  );
  if (stored.bridgeKey)       $("cfg-bridge-key").value    = stored.bridgeKey;
  if (stored.supabaseUrl)     $("cfg-supabase-url").value  = stored.supabaseUrl;
  if (stored.supabaseAnonKey) $("cfg-supabase-key").value  = stored.supabaseAnonKey;
  if (stored.cooldownMs)      $("cfg-cooldown").value      = Math.round(stored.cooldownMs / 1000);
}

$("save-config-btn").addEventListener("click", async () => {
  const bridgeKey       = $("cfg-bridge-key").value.trim();
  const supabaseUrl     = $("cfg-supabase-url").value.trim();
  const supabaseAnonKey = $("cfg-supabase-key").value.trim();
  const cooldownSec     = parseInt($("cfg-cooldown").value, 10);

  if (!bridgeKey) { showToast("Bridge key is required", true); return; }

  await chrome.storage.sync.set({
    bridgeKey,
    supabaseUrl,
    supabaseAnonKey,
    cooldownMs: (cooldownSec || 30) * 1000,
  });

  await sendToContent("reload_config");
  showToast("Config saved & reloaded!");
  refreshStatus();
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadConfigFields();
refreshStatus();

// Refresh every 5 seconds while popup is open (updates cooldown badges)
setInterval(refreshStatus, 5000);
