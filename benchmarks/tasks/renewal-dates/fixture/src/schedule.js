import { addMonths } from "./dates.js";

const PLAN_MONTHS = { monthly: 1, annual: 12 };

// The next `count` renewal dates for a subscription that started on `start`.
export function renewalDates(start, plan, count) {
  const step = PLAN_MONTHS[plan];
  if (!step) throw new Error(`unknown plan: ${plan}`);
  const dates = [];
  let current = start;
  for (let i = 0; i < count; i++) {
    current = addMonths(current, step);
    dates.push(current);
  }
  return dates;
}
