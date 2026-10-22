// Held-out tests. Copied in by the grader after the run; never shown to the agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate, formatDate } from "../src/dates.js";
import { renewalDates } from "../src/schedule.js";
import { upcomingInvoices } from "../src/invoices.js";

const dates = (start, plan, n) => renewalDates(parseDate(start), plan, n).map(formatDate);

test("clamp: a renewal in a short month falls on its last day", () => {
  assert.deepEqual(dates("2024-01-31", "monthly", 1), ["2024-02-29"]);
  assert.deepEqual(dates("2023-01-31", "monthly", 1), ["2023-02-28"]);
  assert.deepEqual(dates("2024-03-31", "monthly", 1), ["2024-04-30"]);
  assert.deepEqual(dates("2024-02-29", "annual", 1), ["2025-02-28"]);
});

test("anchor-monthly: the day of month stays anchored to the start date", () => {
  assert.deepEqual(dates("2024-01-31", "monthly", 5), ["2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31", "2024-06-30"]);
  assert.deepEqual(dates("2024-08-30", "monthly", 3), ["2024-09-30", "2024-10-30", "2024-11-30"]);
});

test("anchor-annual: a 29 February start returns to 29 February in leap years", () => {
  assert.deepEqual(dates("2024-02-29", "annual", 4), ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
});

test("ordinary dates are unchanged", () => {
  assert.deepEqual(dates("2024-01-15", "monthly", 3), ["2024-02-15", "2024-03-15", "2024-04-15"]);
  assert.deepEqual(dates("2024-12-31", "monthly", 2), ["2025-01-31", "2025-02-28"]);
  assert.deepEqual(upcomingInvoices({ start: "2024-01-31", plan: "monthly", tier: "pro" }, 2).map((l) => l.date), ["2024-02-29", "2024-03-31"]);
});
