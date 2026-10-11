// ═══════════════════════════════════════════════════════
// NO EMOJI — the UI draws its icons as vectors (src/client/icons.jsx)
// Run with: npm test
//
// An emoji in the source may only be one that IconText swaps for a vector
// (its TEXT_ICONS table), for strings the game engine builds. Card suits and
// the joker star are card faces, not emoji. Release notes name their icon.
// ═══════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RELEASES } from '../src/releases.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const root = new URL('..', import.meta.url).pathname;
const iconsSrc = readFileSync(join(root, 'src/client/icons.jsx'), 'utf8');
const iconNames = new Set([...iconsSrc.matchAll(/^ {2}(\w+):\s*\[/gm)].map(m => m[1]));
const table = iconsSrc.slice(iconsSrc.indexOf('const TEXT_ICONS'), iconsSrc.indexOf('const TEXT_RE'));
const swapped = new Set([...table.matchAll(/\['([^']+)', '(\w+)'\]/g)].map(m => m[1]));
const CARD_FACES = new Set(['♠', '♥', '♦', '♣', '★']);
const EMOJI = /\p{Extended_Pictographic}️?|️/gu;

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(jsx?|html|css)$/.test(f) ? [p] : [];
  });
}

const stray = [];
for (const f of [...files(join(root, 'src')), join(root, 'index.html'), join(root, 'harness.html')]) {
  if (f.endsWith('icons.jsx')) continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const [e] of line.matchAll(EMOJI)) {
      if (!CARD_FACES.has(e) && !swapped.has(e)) stray.push(`${relative(root, f)}:${i + 1} ${e}`);
    }
  });
}
check('no emoji without a vector icon in its place' + (stray.length ? ':\n        ' + stray.join('\n        ') : ''),
      stray.length === 0);

const badSwap = [...table.matchAll(/\['([^']+)', '(\w+)'\]/g)].filter(m => !iconNames.has(m[2])).map(m => m[2]);
check('every IconText emoji maps to a drawn icon' + (badSwap.length ? ': ' + badSwap.join(', ') : ''), badSwap.length === 0);

const badRel = RELEASES.flatMap(r => r.changes).filter(c => !iconNames.has(c.icon)).map(c => `${c.title} (${c.icon})`);
check('every release note names a drawn icon' + (badRel.length ? ':\n        ' + badRel.join('\n        ') : ''), badRel.length === 0);

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
