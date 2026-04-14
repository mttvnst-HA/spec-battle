#!/usr/bin/env node
// CLI for the heuristic tuning loop.
//
// Usage:
//   node scripts/tune.js                         # full run with defaults
//   node scripts/tune.js --dry-run               # 2-iteration smoke, no writes, no commits
//   node scripts/tune.js --max-iters=20          # cap iterations
//   node scripts/tune.js --max-wall-ms=300000    # cap wall-clock

import { execSync } from "node:child_process";
import fs from "node:fs";
import { runBatch } from "../src/sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../src/sim/policies.js";
import { runLoop } from "../src/tune/loop.js";
import { propose } from "../src/tune/proposer.js";
import { writeProposal, revertProposal } from "../src/tune/applyProposal.js";
import { isConverged, isImprovement } from "../src/tune/convergence.js";
import { makeGit } from "../src/tune/gitOps.js";

function flag(name, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const n = Number(arg.split("=")[1]);
  if (!Number.isFinite(n)) {
    console.error(`Invalid --${name}=${arg.split("=")[1]}`);
    process.exit(1);
  }
  return n;
}
const dryRun = process.argv.includes("--dry-run");
const maxIterations = flag("max-iters", 50);
const maxWallMs = flag("max-wall-ms", 15 * 60 * 1000);

function runSim() {
  const count = 200;
  const startSeed = 1;
  const matchups = [
    runBatch({ startSeed, count, engPolicy: randomPolicy, conPolicy: randomPolicy,
               engPolicyName: "random", conPolicyName: "random" }),
    runBatch({ startSeed, count, engPolicy: randomPolicy, conPolicy: aiPolicy,
               engPolicyName: "random", conPolicyName: "ai" }),
  ];
  return { matchups };
}

function runTests() {
  try {
    execSync("npm test --silent", {
      env: { ...process.env, SKIP_BALANCE_REGRESSION: "1" },
      stdio: "pipe",
    });
    return { ok: true, output: "" };
  } catch (err) {
    return { ok: false, output: String(err.stdout || err.stderr || err.message) };
  }
}

// Graceful stop on SIGINT/SIGTERM: write the abort file; the next iteration
// check-top will catch it.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try { fs.writeFileSync(".tuning-abort", "1"); } catch {}
    console.error(`\n[tune] received ${sig}, abort file written`);
  });
}

const result = runLoop({
  runSim, runTests,
  git: makeGit(),
  fs, clock: { now: () => Date.now() },
  proposer: { propose },
  apply: { write: writeProposal, revert: revertProposal },
  convergence: { isConverged, isImprovement },
  maxIterations, maxWallMs,
  dryRun,
  log: (msg) => console.log(`[tune] ${msg}`),
});

console.log(`[tune] stopped: ${result.reason}`);
if (!dryRun) {
  console.log(`[tune] summary:  tuning-summary.md`);
  console.log(`[tune] next baseline: balance-baseline.next.json`);
  console.log(`[tune] run 'npm run sim:update-baseline' to accept.`);
}
