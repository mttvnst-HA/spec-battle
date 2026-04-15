// Fresh-process sim driver. Spawned by scripts/tune.js per-iteration so that
// ESM JSON import caching can't hide mid-run disk mutations from the sim.
//
// See Phase 2.2e in ROADMAP.md for the cache-bug background.
//
// Usage:
//   node scripts/tune-sim.js '<json-config>'
//
// Config shape:
//   { startSeed: number, count: number, seedChunks: number }
//
// Emits a single JSON line to stdout:
//   { "matchups": [BalanceReport, BalanceReport] }

import { runAveragedBatch } from "../src/sim/runAveragedBatch.js";
import { randomPolicy, aiPolicy } from "../src/sim/policies.js";

const raw = process.argv[2] ?? "";
if (!raw) {
  console.error("tune-sim: missing config JSON in argv[2]");
  process.exit(2);
}

let cfg;
try {
  cfg = JSON.parse(raw);
} catch (err) {
  console.error(`tune-sim: invalid JSON config — ${err.message}`);
  process.exit(2);
}

const { startSeed, count, seedChunks } = cfg;
if (!Number.isInteger(startSeed) || !Number.isInteger(count) || !Number.isInteger(seedChunks)) {
  console.error(`tune-sim: startSeed/count/seedChunks must be integers, got ${JSON.stringify(cfg)}`);
  process.exit(2);
}

const matchups = [
  runAveragedBatch({
    startSeed, count, seedChunks,
    engPolicy: randomPolicy, conPolicy: randomPolicy,
    engPolicyName: "random", conPolicyName: "random",
  }),
  runAveragedBatch({
    startSeed, count, seedChunks,
    engPolicy: randomPolicy, conPolicy: aiPolicy,
    engPolicyName: "random", conPolicyName: "ai",
  }),
];

process.stdout.write(JSON.stringify({ matchups }));
