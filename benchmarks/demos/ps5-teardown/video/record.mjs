#!/usr/bin/env node
// Records compose.html taking the PS5 apart and putting it back, as an MP4
// that loops: both delivered pages side by side, or one alone with --only.
//
//   node site/build.mjs && python3 -m http.server 4321 --directory site/dist &
//   node benchmarks/demos/ps5-teardown/video/record.mjs
//   node benchmarks/demos/ps5-teardown/video/record.mjs --only skillshed --size 1080x1080 --out ps5-skillshed.mp4
//
// Options: --base URL (default http://localhost:4321), --only plain|skillshed,
// --size WxH (default 1920x1080), --out FILE (default site/blog/ps5-teardown/ps5-side-by-side.mp4).
//
// Needs Node 22+ (global WebSocket), Chrome and ffmpeg. compose.html is copied
// next to the demo pages in site/dist so the frame can drive both of them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const base = (arg("base") ?? "http://localhost:4321").replace(/\/$/, "");
const only = arg("only");
const [W, H] = (arg("size") ?? "1920x1080").split("x").map(Number);
const out = path.resolve(arg("out") ?? path.join(REPO, "site/blog/ps5-teardown/ps5-side-by-side.mp4"));
const query = new URLSearchParams({ w: W, h: H, ...(only ? { only } : {}) });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Seconds: hold assembled, take it apart, hold exploded, put it back, hold.
const TIMELINE = [[1.2, "exploded"], [6.6, "assembled"], [10.2, null]];

fs.copyFileSync(path.join(HERE, "compose.html"), path.join(REPO, "site/dist/demos/ps5-teardown/compose.html"));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ps5-video-"));
const frames = fs.mkdtempSync(path.join(os.tmpdir(), "ps5-frames-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const cdp = await connect(profile);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${base}/demos/ps5-teardown/compose.html?${query}` });
  const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

  for (let t = 0; !(await evaluate("typeof ready === 'function' && Boolean(ready())")); t += 250) {
    if (t > 60_000) throw Error("the pages did not finish loading within a minute");
    await sleep(250);
  }
  await evaluate("setView('assembled')");
  await sleep(4000);

  const shots = [];
  cdp.on(({ method, params }) => {
    if (method !== "Page.screencastFrame") return;
    const file = path.join(frames, `${String(shots.length).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(params.data, "base64"));
    // Arrival time, on the same clock as the timeline (metadata.timestamp is not).
    shots.push({ file, t: Date.now() / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const start = Date.now() / 1000;
  for (const [at, view] of TIMELINE) {
    await sleep(Math.max(0, (start + at) * 1000 - Date.now()));
    if (view) await evaluate(`setView(${JSON.stringify(view)})`);
  }
  await cdp.send("Page.stopScreencast");
  const end = Date.now() / 1000;
  cdp.close();
  if (shots.length < 2) throw Error(`only ${shots.length} frame(s) captured`);

  // Frames arrive only when something changes. Lay them on a fixed 30 fps grid:
  // each output frame is the latest capture at that moment.
  const FPS = 30, t0 = shots[0].t, seq = path.join(frames, "seq");
  fs.mkdirSync(seq);
  for (let i = 0, j = 0; i < Math.round((end - t0) * FPS); i++) {
    while (j + 1 < shots.length && shots[j + 1].t <= t0 + i / FPS) j++;
    fs.linkSync(shots[j].file, path.join(seq, `${String(i).padStart(5, "0")}.jpg`));
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(seq, "%05d.jpg"),
    "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", out]);
  console.log(`${shots.length} captures over ${(end - t0).toFixed(1)}s -> ${path.relative(process.cwd(), out)}`);
} finally {
  chrome.kill();
  await sleep(200);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(frames, { recursive: true, force: true });
}

async function connect(dir) {
  const portFile = path.join(dir, "DevToolsActivePort");
  for (let t = 0; !fs.existsSync(portFile) || !fs.readFileSync(portFile, "utf8").includes("\n"); t += 100) {
    if (t > 30_000) throw Error("Chrome did not open a debugging port");
    await sleep(100);
  }
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), listeners = [];
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(Error(m.error.message)) : resolve(m.result);
    } else if (m.method) listeners.forEach((l) => l(m));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, on: (l) => listeners.push(l), close: () => socket.close() };
}
