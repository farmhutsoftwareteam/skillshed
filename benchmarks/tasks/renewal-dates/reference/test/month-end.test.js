import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate, formatDate } from "../src/dates.js";
import { renewalDates } from "../src/schedule.js";

test("a 31 January monthly start renews on 29 February, then back on the 31st", () => {
  assert.deepEqual(renewalDates(parseDate("2024-01-31"), "monthly", 2).map(formatDate), ["2024-02-29", "2024-03-31"]);
});
