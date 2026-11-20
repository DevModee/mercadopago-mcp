import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { buildPaymentSearchQuery, searchPaymentsShape, summarizePayment } from "../src/tools/payments.js";
import { ToolInputError } from "../src/tools/shared.js";
import type { Payment } from "../src/mp/types.js";

const parse = (input: Record<string, unknown>) => z.object(searchPaymentsShape).parse(input);

describe("buildPaymentSearchQuery", () => {
  it("applies default sort and paging", () => {
    assert.deepEqual(buildPaymentSearchQuery(parse({})), {
      sort: "date_created",
      criteria: "desc",
      limit: 30,
      offset: 0,
    });
  });

  it("maps filters to Mercado Pago query names", () => {
    const query = buildPaymentSearchQuery(
      parse({ status: "approved", external_reference: "order-42", payer_email: "buyer@example.com" }),
    );
    assert.equal(query["status"], "approved");
    assert.equal(query["external_reference"], "order-42");
    assert.equal(query["payer.email"], "buyer@example.com");
  });

  it("defaults range to date_created and end_date to NOW", () => {
    const query = buildPaymentSearchQuery(parse({ begin_date: "NOW-7DAYS" }));
    assert.equal(query["range"], "date_created");
    assert.equal(query["begin_date"], "NOW-7DAYS");
    assert.equal(query["end_date"], "NOW");
  });

  it("expands date-only values to full UTC day bounds", () => {
    const query = buildPaymentSearchQuery(
      parse({ range: "date_approved", begin_date: "2026-01-01", end_date: "2026-01-31" }),
    );
    assert.equal(query["range"], "date_approved");
    assert.equal(query["begin_date"], "2026-01-01T00:00:00.000Z");
    assert.equal(query["end_date"], "2026-01-31T23:59:59.999Z");
  });

  it("passes full ISO timestamps through unchanged", () => {
    const query = buildPaymentSearchQuery(parse({ begin_date: "2026-01-01T00:00:00.000-03:00" }));
    assert.equal(query["begin_date"], "2026-01-01T00:00:00.000-03:00");
  });

  it("rejects end_date or range without begin_date", () => {
    assert.throws(() => buildPaymentSearchQuery(parse({ end_date: "NOW" })), ToolInputError);
    assert.throws(() => buildPaymentSearchQuery(parse({ range: "date_approved" })), ToolInputError);
  });

  it("rejects invalid inputs at the schema layer", () => {
    assert.throws(() => parse({ begin_date: "last week" }));
    assert.throws(() => parse({ limit: 500 }));
    assert.throws(() => parse({ status: "paid" }));
    assert.throws(() => parse({ payer_email: "not-an-email" }));
  });
});

describe("summarizePayment", () => {
  it("keeps the fields needed for triage", () => {
    const payment: Payment = {
      id: 123,
      status: "approved",
      status_detail: "accredited",
      date_created: "2026-01-15T10:00:00.000-03:00",
      currency_id: "ARS",
      transaction_amount: 100,
      external_reference: "order-42",
      payer: { email: "buyer@example.com" },
      payment_method_id: "visa",
      payment_type_id: "credit_card",
      live_mode: false,
    };
    assert.deepEqual(summarizePayment(payment), {
      id: 123,
      status: "approved",
      status_detail: "accredited",
      amount: 100,
      refunded: null,
      currency: "ARS",
      date_created: "2026-01-15T10:00:00.000-03:00",
      date_approved: null,
      external_reference: "order-42",
      payer_email: "buyer@example.com",
      payment_method: "visa",
      payment_type: "credit_card",
      live_mode: false,
    });
  });
});
