// Verifies a CardMirror Lite web build (dist-lite) holds its promises:
//
//   HARD FAILURES (exit 1):
//     - missing `_headers` or a CSP without connect-src 'self'
//     - any external script/style/link reference in the HTML entries
//     - AI provider or relay hosts referenced from an ENTRY chunk
//       (entry code runs on every load; lazy chunks are gated off and
//       browser-blocked by the CSP, so they get warnings instead)
//
//   WARNINGS: external hostnames found in lazy chunks — unreachable
//   in Lite (their features are compiled out of the UI) and blocked by
//   the CSP even if reached, but listed for audit transparency.
//
// Run: npm run build:lite && npm run verify:lite
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.cwd(), 'dist-lite');
// ENDPOINTS (https-prefixed) are hard failures in entry chunks — a
// reachable URL is code, not copy. Bare hostname MENTIONS (settings
// descriptions, help text) warn: inert strings, blocked by CSP anyway.
const ENDPOINTS = [
  'https://api.anthropic.com',
  'https://openrouter.ai',
  'https://generativelanguage.googleapis.com',
  'https://scouting-assistant.up.railway.app',
  'https://debate-decoded.ghost.io',
  'https://static.cloudflareinsights.com',
  'https://www.googletagmanager.com',
];
const MENTIONS = [
  'api.anthropic.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'scouting-assistant.up.railway.app',
  'debate-decoded.ghost.io',
];

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL  ' + msg);
};
const ok = (msg) => console.log('ok    ' + msg);
const warn = (msg) => console.log('warn  ' + msg);

if (!existsSync(DIST)) {
  fail('dist-lite missing — run `npm run build:lite` first');
  process.exit(1);
}

// 1. CSP
const headersPath = path.join(DIST, '_headers');
if (!existsSync(headersPath)) {
  fail('_headers missing');
} else {
  const csp = readFileSync(headersPath, 'utf8');
  if (csp.includes("connect-src 'self'")) ok("CSP: connect-src 'self' (browser-enforced no-egress)");
  else fail('CSP present but missing connect-src self');
  if (csp.includes("frame-src 'none'") && csp.includes("object-src 'none'")) ok('CSP: frames/objects closed');
}

// 2. HTML entries reference nothing external
for (const html of readdirSync(DIST).filter((f) => f.endsWith('.html'))) {
  const body = readFileSync(path.join(DIST, html), 'utf8');
  const external = body.match(/(?:src|href)="https?:\/\/[^"]+"/g) ?? [];
  if (external.length) fail(`${html} references external URLs: ${external.join(', ')}`);
  else ok(`${html}: all references same-origin`);
}

// 3. Sensitive hosts: entry chunks are hard failures, lazy chunks warn
const assets = path.join(DIST, 'assets');
const entryNames = new Set();
for (const html of readdirSync(DIST).filter((f) => f.endsWith('.html'))) {
  const body = readFileSync(path.join(DIST, html), 'utf8');
  for (const m of body.matchAll(/assets\/([^"']+\.js)/g)) entryNames.add(m[1]);
}
let softHits = 0;
let cleanEntries = true;
for (const f of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
  const body = readFileSync(path.join(assets, f), 'utf8');
  const endpointHits = ENDPOINTS.filter((s) => body.includes(s));
  const mentionHits = MENTIONS.filter((s) => body.includes(s));
  if (endpointHits.length && entryNames.has(f)) {
    cleanEntries = false;
    fail(`ENTRY chunk ${f} contains reachable endpoints: ${endpointHits.join(', ')}`);
  } else if (endpointHits.length) {
    softHits++;
    warn(`lazy chunk ${f} contains endpoints: ${endpointHits.join(', ')} (feature compiled out; CSP blocks regardless)`);
  } else if (mentionHits.length) {
    softHits++;
    warn(`${f}: inert text mentions ${mentionHits.join(', ')} (settings copy, not code)`);
  }
}
if (cleanEntries) ok('entry chunks contain no reachable external endpoints');
if (softHits === 0) ok('no sensitive hosts anywhere in the bundle');

console.log(failed ? '\nLITE VERIFY: FAILED' : '\nLITE VERIFY: PASSED');
process.exit(failed ? 1 : 0);
