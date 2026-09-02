/** CLI for the heading-id invariant fuzzer — see heading-id-fuzz-core.ts.
 *  Run: npx tsx dev/heading-id-fuzz.mts [seeds] [opsPerSeed] */
import { runHeadingIdFuzz } from './heading-id-fuzz-core.js';

const seeds = Number(process.argv[2] ?? 60);
const ops = Number(process.argv[3] ?? 50);
const res = runHeadingIdFuzz(seeds, ops);
for (const line of res.detail) console.log(line);
console.log(`\n${res.findings} finding(s) across ${seeds} seeds × ${ops} ops`);
for (const [k, v] of [...res.kinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`);
process.exit(res.findings ? 1 : 0);
