import { addMonths } from "./dates.js";

const PLAN_MONTHS = { monthly: 1, annual: 12 };

// The next `count` renewal dates for a subscription that started on `start`.
// Each date is counted from the start, not from the previous renewal, so a
// subscription that starts on the 31st returns to the 31st after a short month.
export function renewalDates(start, plan, count) {
  const step = PLAN_MONTHS[plan];
  if (!step) throw new Error(`unknown plan: ${plan}`);
  const dates = [];
  for (let i = 1; i <= count; i++) dates.push(addMonths(start, step * i));
  return dates;
}
