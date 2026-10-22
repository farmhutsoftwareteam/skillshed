// Calendar-date helpers. A date is a JS Date at UTC midnight.

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
