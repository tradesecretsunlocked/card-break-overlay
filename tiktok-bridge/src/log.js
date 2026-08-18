import { LOG_LEVEL } from "./config.js";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[LOG_LEVEL] ?? LEVELS.info;

/**
 * Redacts anything that looks like a credential before it reaches stdout.
 * Render captures stdout, so a leaked access token here is a leaked token in a log
 * aggregator, which is exactly what the DSPR answers say we do not do.
 */
const SECRET_KEYS = /^(app_?secret|access_?token|refresh_?token|auth_?code|sign|authorization|service_role|.*_key)$/i;

function redact(value, depth = 0) {
  if (depth > 4) return "[deep]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = typeof v === "string" && v.length > 8 ? `${v.slice(0, 4)}...[redacted]` : "[redacted]";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level, msg, meta) {
  if (LEVELS[level] > threshold) return;
  const line = { t: new Date().toISOString(), level, msg, ...(meta ? redact(meta) : {}) };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  error: (m, meta) => emit("error", m, meta),
  warn: (m, meta) => emit("warn", m, meta),
  info: (m, meta) => emit("info", m, meta),
  debug: (m, meta) => emit("debug", m, meta),
};
