// Shared output format for every grader: one JSON object on stdout.
//   { task, checks: [{ id, group, label, pass, detail }], passed, total }
export function report(task, checks) {
  const passed = checks.filter((c) => c.pass).length;
  process.stdout.write(JSON.stringify({ task, checks, passed, total: checks.length }, null, 2) + "\n");
}

export function check(checks, id, group, label, fn) {
  try {
    const r = fn();
    const [pass, detail] = Array.isArray(r) ? r : [Boolean(r), ""];
    checks.push({ id, group, label, pass, detail });
  } catch (e) {
    checks.push({ id, group, label, pass: false, detail: String(e?.message ?? e) });
  }
}

export async function checkAsync(checks, id, group, label, fn) {
  try {
    const r = await fn();
    const [pass, detail] = Array.isArray(r) ? r : [Boolean(r), ""];
    checks.push({ id, group, label, pass, detail });
  } catch (e) {
    checks.push({ id, group, label, pass: false, detail: String(e?.message ?? e) });
  }
}
