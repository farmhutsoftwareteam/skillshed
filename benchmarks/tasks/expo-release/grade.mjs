// Grades the expo-release task by reading the final app.json, eas.json and
// .gitignore. Every check is something EAS Build/Submit or the stores enforce,
// or a documented Expo recommendation (marked "practice").
//
//   node grade.mjs <workdir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { report, check } from "../../lib/report.mjs";

const work = process.argv[2];
if (!work) throw new Error("usage: grade.mjs <workdir>");

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(work, f), "utf8"));
let app, eas, parseError = null;
try {
  for (const f of ["app.config.js", "app.config.ts"]) {
    if (fs.existsSync(path.join(work, f))) throw new Error(`${f} exists; this grader only reads app.json`);
  }
  app = readJson("app.json").expo;
  eas = readJson("eas.json");
} catch (e) {
  parseError = e.message;
}

// Resolves a build profile's "extends" chain, the way eas-cli does.
function profile(name, seen = new Set()) {
  const p = eas?.build?.[name];
  if (!p || seen.has(name)) return {};
  seen.add(name);
  const base = p.extends ? profile(p.extends, seen) : {};
  return { ...base, ...p, ios: { ...base.ios, ...p.ios }, android: { ...base.android, ...p.android } };
}

const checks = [];
const need = () => {
  if (parseError) throw new Error(parseError);
};

check(checks, "configs-parse", "correctness", "app.json and eas.json parse, and a production build profile exists", () => {
  need();
  return [Boolean(eas.build?.production), Object.keys(eas.build ?? {}).join(", ")];
});

const prod = parseError ? {} : profile("production");

check(checks, "android-aab", "correctness", "Production Android builds an app bundle, not an APK (Play rejects APKs)", () => {
  need();
  const t = prod.android?.buildType ?? "app-bundle";
  return [t === "app-bundle", `buildType: ${t}`];
});

check(checks, "store-distribution", "correctness", "Production builds are store builds (no internal distribution or dev client)", () => {
  need();
  const bad = [prod.distribution === "internal" && "distribution internal", prod.developmentClient && "developmentClient"].filter(Boolean);
  return [bad.length === 0, bad.join(", ")];
});

check(checks, "auto-increment", "correctness", "Production builds bump the build number automatically on both platforms", () => {
  need();
  const ios = prod.ios?.autoIncrement ?? prod.autoIncrement;
  const android = prod.android?.autoIncrement ?? prod.autoIncrement;
  const ok = (v) => v === true || v === "buildNumber" || v === "versionCode";
  return [ok(ios) && ok(android), JSON.stringify({ ios, android })];
});

check(checks, "remote-versions", "practice", "Build numbers live on EAS (cli.appVersionSource \"remote\"), so CI builds can't reuse one", () => {
  need();
  return [eas.cli?.appVersionSource === "remote", `appVersionSource: ${eas.cli?.appVersionSource}`];
});

check(checks, "identifiers", "correctness", "iOS bundle ID kept as is, and a valid Android package is set", () => {
  need();
  const pkg = app.android?.package;
  const valid = typeof pkg === "string" && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg);
  return [app.ios?.bundleIdentifier === "com.acmeapps.tidy" && valid, `ios: ${app.ios?.bundleIdentifier}, android: ${pkg}`];
});

check(checks, "submit-profiles", "correctness", "submit.production covers iOS (with an ascAppId slot) and Android", () => {
  need();
  const s = eas.submit?.production ?? {};
  const asc = s.ios?.ascAppId;
  return [typeof asc === "string" && asc.length > 0 && typeof s.android === "object", JSON.stringify({ ascAppId: asc, android: s.android ? Object.keys(s.android) : null })];
});

check(checks, "keys-ignored", "correctness", "Key files referenced from eas.json are git-ignored", () => {
  need();
  const paths = [];
  for (const s of Object.values(eas.submit ?? {})) {
    if (s?.android?.serviceAccountKeyPath) paths.push(s.android.serviceAccountKeyPath);
    if (s?.ios?.ascApiKeyPath) paths.push(s.ios.ascApiKeyPath);
  }
  const notIgnored = paths.filter((p) => {
    try {
      execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: work });
      return false;
    } catch {
      return true;
    }
  });
  return [notIgnored.length === 0, paths.length ? `not ignored: ${notIgnored.join(", ") || "none"}` : "no key paths referenced"];
});

check(checks, "export-compliance", "practice", "Declares no non-exempt encryption (HTTPS only), so TestFlight builds don't wait on the compliance question", () => {
  need();
  const v = app.ios?.config?.usesNonExemptEncryption ?? app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption;
  return [v === false, `value: ${v}`];
});

report("expo-release", checks);
