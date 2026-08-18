import express from "express";
import { APP_KEY, APP_SECRET } from "./config.js";
import { verifyWebhookSignature } from "./sign.js";
import { log } from "./log.js";
import { claimNotification, getShopAuthByShopId, markAuthRevoked } from "./store.js";
import { handleOrderStatusChange, handleInventoryChange } from "./handlers.js";

export const webhookRouter = express.Router();

/** Numeric topic ids, confirmed against the saved TikTok reference pages. */
export const TOPIC = {
  ORDER_STATUS_CHANGE: 1,
  REVERSE_STATUS_UPDATE: 2,
  RECIPIENT_ADDRESS_UPDATE: 3,
  PACKAGE_UPDATE: 4,
  PRODUCT_STATUS_CHANGE: 5,
  CANCELLATION_STATUS_CHANGE: 11,
  SELLER_DEAUTHORIZATION: 6,
  UPCOMING_AUTHORIZATION_EXPIRATION: 7,
  SHOPPABLE_CONTENT_POSTING: 17,
  INVENTORY_STATUS_CHANGE: 27,
  COMBINED_LISTING_CHANGE: 42,
};

/**
 * THE 3 SECOND RULE.
 *
 * TikTok expects HTTP 200 with an EMPTY BODY within 3 seconds. A 401 is treated as a
 * rejection and counts as a failed delivery, which triggers the retry ladder
 * (+2min, +30min, +3hr, +12hr, then dropped).
 *
 * So this handler does exactly three things inline: verify, dedupe, acknowledge.
 * All real work is deferred with setImmediate. Never await business logic here.
 *
 * express.raw() is mounted on this route in server.js because the signature is
 * computed over the RAW BODY BYTES. Parsing to JSON first and re-serializing changes
 * whitespace and key order and the signature will never match.
 */
webhookRouter.post("/", (req, res) => {
  const raw = req.body; // Buffer, thanks to express.raw()

  const ok = verifyWebhookSignature({
    rawBody: raw,
    header: req.get("authorization"),
    appKey: APP_KEY,
    appSecret: APP_SECRET,
  });

  if (!ok) {
    // The signature is the ONLY authentication on this endpoint. TikTok publishes no
    // source IP range, so a bad signature is the whole defence.
    log.warn("rejected webhook with invalid signature");
    return res.status(401).end();
  }

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    log.warn("rejected webhook with unparseable body");
    return res.status(400).end();
  }

  // Acknowledge first, then work. This is the single most important line in the file.
  res.status(200).end();

  setImmediate(() => {
    processEvent(event).catch((e) =>
      log.error("webhook processing failed", {
        type: event?.type,
        tts_notification_id: event?.tts_notification_id,
        error: e.message,
      })
    );
  });
});

async function processEvent(event) {
  const { type, tts_notification_id: notificationId, shop_id: shopId, data } = event ?? {};

  // Delivery is AT LEAST ONCE and there is NO ordering guarantee.
  const fresh = await claimNotification(notificationId, String(type), shopId);
  if (!fresh) {
    log.debug("dropped duplicate webhook", { tts_notification_id: notificationId });
    return;
  }

  log.info("webhook received", { type, shop_id: shopId, tts_notification_id: notificationId });

  switch (Number(type)) {
    case TOPIC.ORDER_STATUS_CHANGE:
      await handleOrderStatusChange({ shopId, data });
      break;

    case TOPIC.INVENTORY_STATUS_CHANGE:
      await handleInventoryChange({ shopId, data });
      break;

    case TOPIC.SELLER_DEAUTHORIZATION: {
      // The actionable identifier is the envelope shop_id, not anything in data.
      // Stop calling for this shop immediately and let the deletion pipeline run.
      log.warn("seller deauthorized, revoking", { shop_id: shopId });
      await markAuthRevoked(shopId, "seller deauthorized via webhook topic 6");
      break;
    }

    case TOPIC.UPCOMING_AUTHORIZATION_EXPIRATION: {
      // Fires 30 days out, then daily. Surfaced loudly so a client never silently
      // goes dark on the day their authorization lapses.
      const auth = await getShopAuthByShopId(shopId);
      log.warn("AUTHORIZATION EXPIRING, re-authorization needed", {
        shop_id: shopId,
        bridge_key: auth?.bridge_key,
        seller_name: auth?.seller_name,
        expiration_time: data?.expiration_time,
      });
      break;
    }

    case TOPIC.CANCELLATION_STATUS_CHANGE:
      // cancel_status walks PENDING -> SUCCESS | CANCELLED -> COMPLETE. Only the
      // terminal SUCCESS/COMPLETE states actually release a slot, and topic 1 fires
      // for those anyway, so this is logged rather than acted on for now.
      log.info("cancellation status change", {
        order_id: data?.order_id,
        cancel_status: data?.cancel_status,
        role: data?.cancellations_role,
      });
      break;

    case TOPIC.SHOPPABLE_CONTENT_POSTING:
    case TOPIC.REVERSE_STATUS_UPDATE:
    case TOPIC.PRODUCT_STATUS_CHANGE:
    case TOPIC.COMBINED_LISTING_CHANGE:
      log.info("topic received but not yet handled", { type, data });
      break;

    default:
      // Roughly ten topics are named in the docs with no published numeric id.
      // Logging the raw shape here is how we discover them in the Development Shop.
      log.info("unmapped webhook topic, capturing shape", { type, data });
  }
}
