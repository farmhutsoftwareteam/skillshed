import { test } from "node:test";
import assert from "node:assert/strict";
import { upcomingInvoices } from "../src/invoices.js";

test("invoice lines carry date, description and amount", () => {
  assert.deepEqual(upcomingInvoices({ start: "2024-01-15", plan: "monthly", tier: "pro" }, 2), [
    { date: "2024-02-15", description: "pro monthly", amountCents: 1200 },
    { date: "2024-03-15", description: "pro monthly", amountCents: 1200 },
  ]);
});

test("annual plans are billed at ten months' price", () => {
  const [first] = upcomingInvoices({ start: "2024-05-01", plan: "annual", tier: "team" }, 1);
  assert.equal(first.amountCents, 99000);
  assert.equal(first.date, "2025-05-01");
});
