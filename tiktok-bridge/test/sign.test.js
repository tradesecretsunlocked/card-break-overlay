import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { signRequest, verifyWebhookSignature } from "../src/sign.js";

/**
 * TikTok's own worked example from the signing documentation.
 * If this fails, nothing else in the integration will work, so it runs first.
 */
test("signRequest matches TikTok's published worked example", () => {
  const sign = signRequest({
    path: "/authorization/202309/shops",
    query: { app_key: "29a39d", timestamp: 1623812664 },
    body: "",
    appSecret: "e59af819cc",
  });
  assert.equal(sign, "b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8");
});

test("signRequest excludes sign and access_token from the signature base", () => {
  const base = signRequest({
    path: "/authorization/202309/shops",
    query: { app_key: "29a39d", timestamp: 1623812664 },
    appSecret: "e59af819cc",
  });
  const withNoise = signRequest({
    path: "/authorization/202309/shops",
    query: {
      app_key: "29a39d",
      timestamp: 1623812664,
      sign: "should-be-ignored",
      access_token: "should-also-be-ignored",
    },
    appSecret: "e59af819cc",
  });
  assert.equal(base, withNoise);
});

test("signRequest sorts query keys alphabetically, not by insertion order", () => {
  const a = signRequest({
    path: "/order/202309/orders/search",
    query: { app_key: "k", shop_cipher: "c", timestamp: 1 },
    appSecret: "s",
  });
  const b = signRequest({
    path: "/order/202309/orders/search",
    query: { timestamp: 1, app_key: "k", shop_cipher: "c" },
    appSecret: "s",
  });
  assert.equal(a, b);
});

test("signRequest includes the body for json requests and omits it for multipart", () => {
  const body = '{"page_size":10}';
  const withBody = signRequest({ path: "/p", query: {}, body, appSecret: "s" });
  const withoutBody = signRequest({ path: "/p", query: {}, body: "", appSecret: "s" });
  const multipart = signRequest({
    path: "/p",
    query: {},
    body,
    appSecret: "s",
    contentType: "multipart/form-data",
  });
  assert.notEqual(withBody, withoutBody);
  assert.equal(multipart, withoutBody);
});

test("signRequest is sensitive to body whitespace, which is why we sign the transmitted string", () => {
  const compact = signRequest({ path: "/p", body: '{"a":1}', appSecret: "s" });
  const spaced = signRequest({ path: "/p", body: '{"a": 1}', appSecret: "s" });
  assert.notEqual(
    compact,
    spaced,
    "re-serializing the body after signing WILL break the signature with error 106001"
  );
});

test("signRequest rejects a path that does not start with a slash", () => {
  assert.throws(() => signRequest({ path: "order/202309/orders", appSecret: "s" }), /must start with/);
});

test("verifyWebhookSignature accepts a correctly signed raw body", () => {
  const appKey = "6k99cjquf3k04";
  const appSecret = "test-secret";
  const rawBody = Buffer.from('{"type":1,"tts_notification_id":"7327112393057371910"}', "utf8");
  const header = crypto
    .createHmac("sha256", appSecret)
    .update(appKey + rawBody.toString("utf8"), "utf8")
    .digest("hex");

  assert.equal(verifyWebhookSignature({ rawBody, header, appKey, appSecret }), true);
});

test("verifyWebhookSignature tolerates a Bearer prefix but does not require one", () => {
  const appKey = "k";
  const appSecret = "s";
  const rawBody = Buffer.from("{}", "utf8");
  const sig = crypto.createHmac("sha256", appSecret).update(appKey + "{}", "utf8").digest("hex");

  assert.equal(verifyWebhookSignature({ rawBody, header: sig, appKey, appSecret }), true);
  assert.equal(verifyWebhookSignature({ rawBody, header: `Bearer ${sig}`, appKey, appSecret }), true);
});

test("verifyWebhookSignature rejects a tampered body, a wrong secret, and a missing header", () => {
  const appKey = "k";
  const appSecret = "s";
  const rawBody = Buffer.from('{"amount":100}', "utf8");
  const sig = crypto
    .createHmac("sha256", appSecret)
    .update(appKey + rawBody.toString("utf8"), "utf8")
    .digest("hex");

  const tampered = Buffer.from('{"amount":999}', "utf8");
  assert.equal(verifyWebhookSignature({ rawBody: tampered, header: sig, appKey, appSecret }), false);
  assert.equal(verifyWebhookSignature({ rawBody, header: sig, appKey, appSecret: "wrong" }), false);
  assert.equal(verifyWebhookSignature({ rawBody, header: undefined, appKey, appSecret }), false);
  assert.equal(verifyWebhookSignature({ rawBody, header: "", appKey, appSecret }), false);
});
