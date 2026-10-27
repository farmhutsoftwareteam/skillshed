#!/usr/bin/env node
// Renders the drawing with annotations (and optionally fills) for visual review.
// Usage: node scripts/annotated-proof.cjs drawing.json out/ [explosion]
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), {execFileSync} = require('node:child_process');
const teardown = path.resolve(__dirname, '../tools/teardown/scripts');
const {findChrome} = require(path.join(teardown, 'commands.cjs'));
const {assets, RUNTIME, load} = require(path.join(teardown, 'config.cjs'));
const SHEET = require(path.join(assets, 'sheet.js'));
const [configPath, outDir, explosionArg = '1'] = process.argv.slice(2);
const {config, modelScripts} = load(configPath);
const context = {console, structuredClone};
context.self = context;
vm.createContext(context);
for (const file of [...RUNTIME, ...modelScripts]) vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
fs.mkdirSync(outDir, {recursive: true});
const explosion = Number(explosionArg);
for (const d of config.drawings) {
  const values = Object.fromEntries(d.parameters.map(p => [p.key, p.default]));
  const {markup} = context.DrawingModels[d.id](values, {explosion, fitExplosion: Math.max(explosion, 1), isolated: null, annotate: true});
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1414" viewBox="0 0 ${SHEET.width} ${SHEET.height}">`
    + `<style>path{fill:none;stroke:#202020;stroke-linejoin:round}[data-ink-fill]{fill:#202020}text{font-family:Inter,Helvetica,sans-serif}${SHEET.css('technical')}</style>`
    + `<rect width="100%" height="100%" fill="#fff"/>${markup}</svg>`;
  const file = path.resolve(outDir, `${d.id}-annotated-${explosion}.svg`);
  fs.writeFileSync(file, svg);
  execFileSync(findChrome(), ['--headless', '--disable-gpu', '--hide-scrollbars', `--screenshot=${file.replace(/svg$/, 'png')}`, '--window-size=2000,1414', '--default-background-color=ffffffff', `file://${file}`], {stdio: 'ignore'});
  console.log(file.replace(/svg$/, 'png'));
}
