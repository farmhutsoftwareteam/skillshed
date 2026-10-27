#!/usr/bin/env node
// Drives dist/index.html in headless Chrome: turns on annotations, recolours and fills parts,
// zooms and scrolls, then downloads SVG, PNG and PDF from the exploded and assembled views.
// Usage: node scripts/download-check.cjs dist/index.html check/downloads/
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {spawn} = require('node:child_process');
const {findChrome} = require('../tools/teardown/scripts/commands.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [htmlPath, outDir] = process.argv.slice(2);

async function connect(profile) {
  const portFile = path.join(profile, 'DevToolsActivePort');
  while (!fs.existsSync(portFile) || !fs.readFileSync(portFile, 'utf8').includes('\n')) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  let id = 0;
  const pending = new Map(), events = [];
  socket.onmessage = ({data}) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
  return {send, events, close: () => socket.close()};
}

(async () => {
  const out = path.resolve(outDir);
  fs.mkdirSync(out, {recursive: true});
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'download-check-'));
  const browser = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,900', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  try {
    const cdp = await connect(profile);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath: out, eventsEnabled: true});
    await cdp.send('Page.navigate', {url: 'file://' + path.resolve(htmlPath)});
    const run = async expression => {
      const r = await cdp.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const settle = async () => {
      await sleep(300);
      for (let i = 0; i < 600; i++) {
        const s = await run(`({busy: document.getElementById('viewport').getAttribute('aria-busy'), status: document.getElementById('render-status').textContent})`);
        if (s.busy === 'false') return s.status;
        await sleep(200);
      }
      throw Error('Render timed out');
    };
    const downloads = [];
    const save = async (format, label) => {
      const before = cdp.events.length;
      await run(`document.querySelector('.export-choice[data-format="${format}"]').click()`);
      for (let i = 0; i < 300; i++) {
        const done = cdp.events.slice(before).find(e => e.method === 'Browser.downloadProgress' && e.params.state === 'completed');
        if (done) {
          const begin = cdp.events.find(e => e.method === 'Browser.downloadWillBegin' && e.params.guid === done.params.guid);
          const file = path.join(out, `${label}.${format}`);
          fs.renameSync(path.join(out, done.params.guid), file);
          downloads.push({file, suggested: begin?.params.suggestedFilename});
          return;
        }
        await sleep(100);
      }
      throw Error(`No ${format} download for ${label}`);
    };
    const set = (id, prop, value, event) => run(`(() => { const e = document.getElementById('${id}'); e.${prop} = ${JSON.stringify(value)}; e.dispatchEvent(new Event('${event}', {bubbles: true})); })()`);

    console.log('initial:', await settle());
    await set('annotate', 'checked', true, 'change'); console.log('annotate:', await settle());
    await set('color-target', 'value', 'all', 'change');
    await set('hue', 'value', '210', 'input');
    await set('color-target', 'value', 'heatsink', 'change');
    await set('hue', 'value', '20', 'input');
    await set('fill', 'checked', true, 'change'); console.log('fill heatsink:', await settle());
    await run(`document.getElementById('zoom-in').click(); document.getElementById('zoom-in').click(); document.getElementById('viewport').scrollBy(200, 150)`);
    await sleep(500);
    for (const f of ['svg', 'png', 'pdf']) await save(f, 'exploded-annotated');
    await set('color-target', 'value', 'all', 'change');
    await set('fill', 'checked', true, 'change'); console.log('fill all:', await settle());
    await run(`document.querySelector('[data-view="assembled"]').click()`); console.log('assembled:', await settle());
    await save('svg', 'assembled-filled'); await save('png', 'assembled-filled');
    await set('tight-crop', 'checked', true, 'change'); await set('transparent', 'checked', true, 'change');
    await save('png', 'assembled-crop-transparent');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(path.join(out, 'page-assembled.png'), Buffer.from(shot.data, 'base64'));
    await run(`document.querySelector('[data-view="exploded"]').click()`); await settle();
    await set('part-target', 'value', 'fan', 'change');
    await run(`document.getElementById('isolate-part').click()`); console.log('isolated:', await settle());
    await set('tight-crop', 'checked', false, 'change'); await set('transparent', 'checked', false, 'change');
    await save('svg', 'isolated-fan'); await save('png', 'isolated-fan');
    const errors = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
    for (const d of downloads) console.log('saved', path.basename(d.file), '<-', d.suggested, fs.statSync(d.file).size, 'bytes');
    console.log(errors.length ? `PAGE ERRORS: ${JSON.stringify(errors.map(e => e.params))}` : 'no page errors');
    cdp.close();
  } finally {
    browser.kill(); await sleep(300); fs.rmSync(profile, {recursive: true, force: true});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
