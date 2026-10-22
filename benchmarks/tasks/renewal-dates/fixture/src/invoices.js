import { formatDate, parseDate } from "./dates.js";
import { renewalDates } from "./schedule.js";

const PRICES = { pro: 1200, team: 9900 };

// Upcoming invoice lines for a subscription, e.g.
//   { start: "2024-01-15", plan: "monthly", tier: "pro" }
export function upcomingInvoices(subscription, count = 3) {
  const { start, plan, tier } = subscription;
  const amount = PRICES[tier];
  if (amount === undefined) throw new Error(`unknown tier: ${tier}`);
  return renewalDates(parseDate(start), plan, count).map((date) => ({
    date: formatDate(date),
    description: `${tier} ${plan}`,
    amountCents: plan === "annual" ? amount * 10 : amount,
  }));
}
