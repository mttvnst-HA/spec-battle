// Fresh-process sim driver. Spawned by scripts/tune.js per-iteration because
// ESM JSON imports are module-init-only — an in-process runSim() would keep
// reading the cached baseline regardless of what writeBundle just wrote to
// content/*.json. Each subprocess call gets a clean module-init.
//
// See CLAUDE.md "Tuning harness" (Phase 2.2e) and ROADMAP.md Phase 2.2e for
// the cache-bug diagnosis.
//
// Usage:
//   node scripts/tune-sim.js '<json-config>'
//
// Config shape:
//   { startSeed: integer, count: integer ≥ 1, seedChunks: integer ≥ 1 }
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
if (!Number.isInteger(startSeed)) {
  console.error(`tune-sim: startSeed must be an integer, got ${JSON.stringify(startSeed)}`);
  process.exit(2);
}
if (!Number.isInteger(count) || count < 1) {
  console.error(`tune-sim: count must be a positive integer, got ${JSON.stringify(count)}`);
  process.exit(2);
}
if (!Number.isInteger(seedChunks) || seedChunks < 1) {
  console.error(`tune-sim: seedChunks must be a positive integer, got ${JSON.stringify(seedChunks)}`);
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
