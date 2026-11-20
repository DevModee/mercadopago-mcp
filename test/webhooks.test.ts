import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildManifest, parseSignatureHeader, verifyWebhookSignature } from "../src/tools/webhooks.js";

// Vectors computed independently with:
//   printf '%s' '<manifest>' | openssl dgst -sha256 -hmac 'test_webhook_secret_unused' -hex
const SECRET = "test_webhook_secret_unused";
const TS = "1742505638683";
const REQUEST_ID = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
// manifest: id:123456789;request-id:bb56a2f1-...;ts:1742505638683;
const FULL_SIG = "0163c308a073154a8127008a19af97a31cd5b57bb348b5e122b20c4dabe312b1";
// manifest: id:abc123def;ts:1742505638683;
const NO_REQ_SIG = "42709df487aa7214d9e89af25fe26c0e9b7454dd296fc46e2ac75b38d4828421";
const NOW = Number(TS) + 30_000;

describe("parseSignatureHeader", () => {
  it("reads ts and v1 regardless of order and spacing", () => {
    assert.deepEqual(parseSignatureHeader(` v1=${FULL_SIG} , ts=${TS}`), { ts: TS, v1: FULL_SIG });
  });

  it("ignores unknown or malformed parts", () => {
    assert.deepEqual(parseSignatureHeader("foo=bar,junk,ts=1"), { ts: "1" });
  });
});

describe("buildManifest", () => {
  it("drops absent parts and lowercases data.id", () => {
    assert.equal(buildManifest(TS, "ABC123DEF"), `id:abc123def;ts:${TS};`);
    assert.equal(buildManifest(TS, undefined, REQUEST_ID), `request-id:${REQUEST_ID};ts:${TS};`);
    assert.equal(buildManifest(TS), `ts:${TS};`);
  });
});

describe("verifyWebhookSignature", () => {
  const base = {
    xSignature: `ts=${TS},v1=${FULL_SIG}`,
    xRequestId: REQUEST_ID,
    dataId: "123456789",
    secret: SECRET,
    now: NOW,
  };

  it("accepts a valid signature", () => {
    const result = verifyWebhookSignature(base);
    assert.equal(result.valid, true);
    assert.equal(result.manifest, `id:123456789;request-id:${REQUEST_ID};ts:${TS};`);
    assert.equal(result.age_seconds, 30);
  });

  it("accepts uppercase hex and an uppercase alphanumeric data.id", () => {
    const result = verifyWebhookSignature({
      xSignature: `ts=${TS},v1=${NO_REQ_SIG.toUpperCase()}`,
      dataId: "ABC123DEF",
      secret: SECRET,
      now: NOW,
    });
    assert.equal(result.valid, true);
  });

  it("rejects a tampered data.id", () => {
    assert.equal(verifyWebhookSignature({ ...base, dataId: "123456780" }).valid, false);
  });

  it("rejects a tampered x-request-id", () => {
    assert.equal(verifyWebhookSignature({ ...base, xRequestId: `${REQUEST_ID}0` }).valid, false);
  });

  it("rejects a tampered ts", () => {
    const result = verifyWebhookSignature({ ...base, xSignature: `ts=1742505638684,v1=${FULL_SIG}` });
    assert.equal(result.valid, false);
  });

  it("rejects a flipped signature byte", () => {
    const flipped = `${FULL_SIG.slice(0, -1)}${FULL_SIG.endsWith("1") ? "0" : "1"}`;
    assert.equal(verifyWebhookSignature({ ...base, xSignature: `ts=${TS},v1=${flipped}` }).valid, false);
  });

  it("rejects the wrong secret", () => {
    const result = verifyWebhookSignature({ ...base, secret: "another_fake_secret" });
    assert.equal(result.valid, false);
    assert.match(result.reason, /mismatch/);
  });

  it("rejects malformed headers without throwing", () => {
    const headers = ["", "v1=abc", `ts=${TS}`, `ts=${TS},v1=xyz`, `ts=abc,v1=${FULL_SIG}`, `ts=${TS},v1=${FULL_SIG}00`];
    for (const xSignature of headers) {
      const result = verifyWebhookSignature({ ...base, xSignature });
      assert.equal(result.valid, false, xSignature);
      assert.equal(result.manifest, null);
    }
  });

  it("enforces max_age_seconds only when set", () => {
    const later = Number(TS) + 600_000;
    assert.equal(verifyWebhookSignature({ ...base, now: later }).valid, true);
    const stale = verifyWebhookSignature({ ...base, now: later, maxAgeSeconds: 300 });
    assert.equal(stale.valid, false);
    assert.match(stale.reason, /600s old/);
    assert.equal(verifyWebhookSignature({ ...base, maxAgeSeconds: 300 }).valid, true);
  });

  it("treats second-precision ts as seconds when computing age", () => {
    const result = verifyWebhookSignature({
      ...base,
      xSignature: `ts=1742505638,v1=${FULL_SIG}`,
      now: 1742505668_000,
    });
    assert.equal(result.age_seconds, 30);
  });

  it("never includes the secret in the result", () => {
    const result = verifyWebhookSignature({ ...base, secret: "another_fake_secret" });
    assert.ok(!JSON.stringify(result).includes("another_fake_secret"));
  });
});
