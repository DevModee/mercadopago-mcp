import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { ToolInputError } from "../src/tools/shared.js";
import {
  buildPreferenceRequest,
  buildRefundRequest,
  createPreferenceShape,
  refundPaymentShape,
} from "../src/tools/writes.js";

const parsePreference = (input: Record<string, unknown>) => z.object(createPreferenceShape).parse(input);
const parseRefund = (input: Record<string, unknown>) => z.object(refundPaymentShape).parse(input);

describe("buildRefundRequest", () => {
  it("sends the amount for partial refunds", () => {
    assert.deepEqual(buildRefundRequest(parseRefund({ payment_id: "1", amount: 12.5 })), { amount: 12.5 });
  });

  it("sends an empty body only when full_refund is explicit", () => {
    assert.deepEqual(buildRefundRequest(parseRefund({ payment_id: 1, full_refund: true })), {});
  });

  it("refuses ambiguous refunds", () => {
    assert.throws(() => buildRefundRequest(parseRefund({ payment_id: "1" })), ToolInputError);
    assert.throws(
      () => buildRefundRequest(parseRefund({ payment_id: "1", full_refund: false })),
      ToolInputError,
    );
    assert.throws(
      () => buildRefundRequest(parseRefund({ payment_id: "1", amount: 5, full_refund: true })),
      ToolInputError,
    );
  });

  it("validates amount and payment_id", () => {
    assert.throws(() => parseRefund({ payment_id: "1", amount: -1 }));
    assert.throws(() => parseRefund({ payment_id: "abc", full_refund: true }));
  });
});

describe("buildPreferenceRequest", () => {
  it("builds a minimal preference", () => {
    const body = buildPreferenceRequest(
      parsePreference({ items: [{ title: "Leather wallet", quantity: 1, unit_price: 2500 }] }),
    );
    assert.deepEqual(body, { items: [{ title: "Leather wallet", quantity: 1, unit_price: 2500 }] });
  });

  it("maps optional fields and marks expiring preferences", () => {
    const body = buildPreferenceRequest(
      parsePreference({
        items: [{ title: "Belt", quantity: 2, unit_price: 10, currency_id: "ARS" }],
        external_reference: "order-42",
        back_urls: { success: "https://shop.example.com/ok" },
        auto_return: "approved",
        payer_email: "buyer@example.com",
        expiration_date_to: "2026-12-31T23:59:59.000-03:00",
        metadata: { order_id: 42 },
      }),
    );
    assert.equal(body.external_reference, "order-42");
    assert.deepEqual(body.back_urls, { success: "https://shop.example.com/ok" });
    assert.equal(body.auto_return, "approved");
    assert.deepEqual(body.payer, { email: "buyer@example.com" });
    assert.equal(body.expires, true);
    assert.deepEqual(body.metadata, { order_id: 42 });
    assert.equal(body.items[0]?.currency_id, "ARS");
  });

  it("requires back_urls.success for auto_return", () => {
    assert.throws(
      () =>
        buildPreferenceRequest(
          parsePreference({ items: [{ title: "x", quantity: 1, unit_price: 1 }], auto_return: "all" }),
        ),
      ToolInputError,
    );
  });

  it("rejects empty items and non-HTTPS URLs", () => {
    assert.throws(() => parsePreference({ items: [] }));
    assert.throws(() =>
      parsePreference({
        items: [{ title: "x", quantity: 1, unit_price: 1 }],
        notification_url: "http://insecure.example.com/hook",
      }),
    );
  });
});
