import crypto from "node:crypto";

/**
 * TikTok Shop request signature.
 *
 * Algorithm, from the official docs:
 *   1. Take every query param EXCEPT `sign` and `access_token`, sort keys alphabetically.
 *   2. Concatenate as {key}{value} with no separators.
 *   3. Prepend the API path exactly as it appears after the host.
 *   4. If content-type is not multipart/form-data, append the raw request body.
 *   5. Wrap the whole thing: {app_secret}{string}{app_secret}
 *   6. HMAC-SHA256 with app_secret as the key, lowercase hex.
 *
 * THE TRAP: you must sign the exact bytes you transmit. If you sign an object and then
 * JSON.stringify it again downstream, key order or whitespace can differ and the
 * signature breaks with error 106001. Always build the body string once and pass the
 * same string to both signRequest() and fetch().
 */
export function signRequest({ path, query = {}, body = "", appSecret, contentType = "application/json" }) {
  if (!appSecret) throw new Error("signRequest: appSecret is required");
  if (!path || !path.startsWith("/")) throw new Error(`signRequest: path must start with / (got ${path})`);

  const keys = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .filter((k) => query[k] !== undefined && query[k] !== null)
    .sort();

  let s = "";
  for (const k of keys) s += `${k}${query[k]}`;
  s = path + s;

  if (contentType !== "multipart/form-data" && body) {
    s += typeof body === "string" ? body : JSON.stringify(body);
  }

  const wrapped = appSecret + s + appSecret;
  return crypto.createHmac("sha256", appSecret).update(wrapped, "utf8").digest("hex");
}

/**
 * Webhook signature verification.
 *
 * TikTok sends HMAC-SHA256(app_key + raw_body, app_secret) as lowercase hex in the
 * `Authorization` header, with NO "Bearer " prefix.
 *
 * THE TRAP: verify against the RAW body bytes. Express's json() parser destroys them.
 * This service uses express.raw() on the webhook route for exactly this reason.
 */
export function verifyWebhookSignature({ rawBody, header, appKey, appSecret }) {
  if (!header) return false;
  const provided = String(header).replace(/^Bearer\s+/i, "").trim().toLowerCase();
  const payload = appKey + (Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? ""));
  const expected = crypto.createHmac("sha256", appSecret).update(payload, "utf8").digest("hex");

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Unix seconds. TikTok rejects anything outside now-5min .. now+30sec with 36009004. */
export function timestamp() {
  return Math.floor(Date.now() / 1000);
}

/** Cryptographically random `state` for the OAuth handshake. Single use, session bound. */
export function makeState() {
  return crypto.randomBytes(24).toString("base64url");
}
