#!/usr/bin/env node
// Runs the two standard matchups and writes either balance-report.json or balance-baseline.json.
// Usage:
//   node scripts/simulate.js                         # writes balance-report.json
//   node scripts/simulate.js --update-baseline      # writes balance-baseline.json
//   node scripts/simulate.js --count=200 --seed=1   # tune batch size / seed

import fs from "node:fs";
import { runBatch } from "../src/sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../src/sim/policies.js";

const args = process.argv.slice(2);
const isUpdateBaseline = args.includes("--update-baseline");

function flag(name, fallback) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const raw = arg.split("=")[1];
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`Invalid --${name}=${raw} (must be a finite number)`);
    process.exit(1);
  }
  return n;
}

const count = flag("count", 200);
const startSeed = flag("seed", 1);

if (!Number.isInteger(count) || count <= 0) {
  console.error(`Invalid --count=${count} (must be a positive integer)`);
  process.exit(1);
}

const matchups = [
  {
    name: "random-vs-random",
    engPolicy: randomPolicy, conPolicy: randomPolicy,
    engPolicyName: "random", conPolicyName: "random",
  },
  {
    name: "random-vs-ai",
    engPolicy: randomPolicy, conPolicy: aiPolicy,
    engPolicyName: "random", conPolicyName: "ai",
  },
];

const report = {
  matchups: matchups.map((m) =>
    runBatch({ startSeed, count, engPolicy: m.engPolicy, conPolicy: m.conPolicy,
               engPolicyName: m.engPolicyName, conPolicyName: m.conPolicyName })
  ),
};

const outPath = isUpdateBaseline ? "balance-baseline.json" : "balance-report.json";
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
for (const m of report.matchups) {
  console.log(
    `  ${m.matchup}: engineer ${(m.engineerWinRate * 100).toFixed(1)}% / ` +
    `contractor ${(m.contractorWinRate * 100).toFixed(1)}% / ` +
    `draw ${(m.drawRate * 100).toFixed(1)}% — avg ${m.avgTurns} turns over ${m.count} games`
  );
}
