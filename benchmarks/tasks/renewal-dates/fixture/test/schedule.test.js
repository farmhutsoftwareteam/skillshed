import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate, formatDate } from "../src/dates.js";
import { renewalDates } from "../src/schedule.js";

const dates = (start, plan, n) => renewalDates(parseDate(start), plan, n).map(formatDate);

test("monthly renewals land on the same day each month", () => {
  assert.deepEqual(dates("2024-01-15", "monthly", 3), ["2024-02-15", "2024-03-15", "2024-04-15"]);
});

test("annual renewals land on the same date each year", () => {
  assert.deepEqual(dates("2023-06-10", "annual", 2), ["2024-06-10", "2025-06-10"]);
});

test("unknown plans are rejected", () => {
  assert.throws(() => renewalDates(parseDate("2024-01-01"), "weekly", 1), /unknown plan/);
});
