// Calendar-date helpers. A date is a JS Date at UTC midnight.

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// Adds whole months, clamping to the last day of the target month.
export function addMonths(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}
