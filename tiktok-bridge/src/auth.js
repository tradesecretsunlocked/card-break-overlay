import express from "express";
import { AUTHORIZE_BASE, SERVICE_ID, PUBLIC_BASE_URL } from "./config.js";
import { makeState } from "./sign.js";
import { exchangeAuthCode, getAuthorizedShops } from "./tiktokClient.js";
import { putOAuthState, consumeOAuthState, saveShopAuth, isActiveBridgeKey } from "./store.js";
import { log } from "./log.js";

export const authRouter = express.Router();

/**
 * Step 1. Send the seller to TikTok.
 *
 * The seller link is built from SERVICE_ID, not app_key. Only the creator flow uses
 * app_key. Using the wrong one produces an authorization page that looks right and
 * then fails at the callback.
 */
authRouter.get("/authorize", async (req, res) => {
  const bridgeKey = String(req.query.bridge_key || "").trim();
  if (!bridgeKey) return res.status(400).json({ error: "bridge_key is required" });

  if (!(await isActiveBridgeKey(bridgeKey))) {
    return res.status(403).json({ error: "unknown or inactive bridge key" });
  }

  // `state` is server generated, unpredictable, single use, and bound to the client.
  // It is what stops someone pasting their own auth_code against another client's key.
  const state = makeState();
  await putOAuthState(state, bridgeKey);

  const url = `${AUTHORIZE_BASE}?${new URLSearchParams({ service_id: SERVICE_ID, state })}`;
  log.info("starting tiktok authorization", { bridge_key: bridgeKey });
  res.redirect(url);
});

/**
 * Step 2. TikTok redirects back with ?code=&state=.
 *
 * This URL must match the Redirect URL configured in Partner Center exactly.
 * The auth_code expires in 30 minutes and is single use, so this handler does the
 * exchange immediately and never queues it.
 */
authRouter.get("/callback", async (req, res) => {
  const authCode = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();

  if (!authCode || !state) {
    return res.status(400).send(renderPage("Authorization failed", "Missing code or state in the callback."));
  }

  const bridgeKey = await consumeOAuthState(state);
  if (!bridgeKey) {
    log.warn("rejected callback with unknown, used, or expired state");
    return res.status(400).send(renderPage("Authorization failed", "This link has already been used or has expired. Please start again."));
  }

  try {
    const tokens = await exchangeAuthCode(authCode);

    // Every business call needs shop_cipher. Fetching it here means the rest of the
    // service never has to think about it. A missing cipher is error 106013.
    const shops = await getAuthorizedShops(tokens.access_token);
    const shop = shops?.shops?.[0];
    if (!shop) throw new Error("authorization succeeded but no shop was returned");

    await saveShopAuth({
      bridge_key: bridgeKey,
      shop_id: shop.id,
      shop_cipher: shop.cipher,
      shop_name: shop.name ?? null,
      shop_region: shop.region ?? null,
      seller_type: shop.seller_type ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_expires_at: new Date(tokens.access_token_expire_in * 1000).toISOString(),
      refresh_expires_at: tokens.refresh_token_expire_in
        ? new Date(tokens.refresh_token_expire_in * 1000).toISOString()
        : null,
      open_id: tokens.open_id ?? null,
      seller_name: tokens.seller_name ?? null,
      seller_base_region: tokens.seller_base_region ?? null,
      user_type: tokens.user_type ?? null,
      granted_scopes: tokens.granted_scopes ?? null,
      status: "active",
      last_refresh_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    log.info("tiktok shop authorized", {
      bridge_key: bridgeKey,
      shop_id: shop.id,
      seller_name: tokens.seller_name,
    });

    res.send(
      renderPage(
        "Connected",
        `Your TikTok Shop <strong>${escapeHtml(shop.name || shop.id)}</strong> is now connected to your TSU overlay. You can close this window.`
      )
    );
  } catch (e) {
    log.error("authorization callback failed", { bridge_key: bridgeKey, error: e.message });
    res.status(500).send(renderPage("Authorization failed", escapeHtml(e.message)));
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - Trade Secrets Unlocked</title>
<style>
:root{--bg:#0d0f14;--fg:#f2f4f8;--muted:#8b93a7;--accent:#00d6b2}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);
font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}
.card{max-width:520px;background:linear-gradient(160deg,#161a22,#0f1218);border:1px solid #222836;
border-radius:16px;padding:36px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.5)}
h1{margin:0 0 12px;font-size:24px;letter-spacing:-.01em}
p{margin:0;color:var(--muted)}
strong{color:var(--accent)}
.brand{margin-top:26px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4c556b}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${body}</p>
<div class="brand">Trade Secrets Unlocked</div></div></body></html>`;
}
