#!/usr/bin/env node
// Report which vs_* buckets in content/quotes/*.json are missing or thin.
// Usage: node scripts/dialog-author/coverage.js [--min=2]

import fs from "node:fs";
import path from "node:path";

const MIN = Number((process.argv.find((a) => a.startsWith("--min=")) || "--min=2").split("=")[1]);

const engineerMoves = JSON.parse(fs.readFileSync("content/moves/engineer.json", "utf8"));
const contractorMoves = JSON.parse(fs.readFileSync("content/moves/contractor.json", "utf8"));
const engineerQuotes = JSON.parse(fs.readFileSync("content/quotes/engineer.json", "utf8"));
const contractorQuotes = JSON.parse(fs.readFileSync("content/quotes/contractor.json", "utf8"));

function vsKey(n) { return "vs_" + n.replace(/[ -]/g, "_"); }

function report(label, ourMoves, theirMoves, quotes) {
  const missing = [];
  const thin = [];
  ourMoves.forEach((m) => {
    theirMoves.forEach((t) => {
      const key = vsKey(t.name);
      const pool = (quotes[m.name] && quotes[m.name][key]) || [];
      if (pool.length === 0) missing.push(`${m.name}.${key}`);
      else if (pool.length < MIN) thin.push(`${m.name}.${key} (${pool.length}/${MIN})`);
    });
  });
  const total = ourMoves.length * theirMoves.length;
  const populated = total - missing.length;
  console.log(`\n=== ${label} coverage: ${populated}/${total} buckets (min ${MIN}) ===`);
  if (thin.length) console.log(`Thin buckets:\n  ${thin.join("\n  ")}`);
  if (missing.length) console.log(`Missing buckets:\n  ${missing.join("\n  ")}`);
  return { populated, total, missing, thin };
}

const e = report("Engineer", engineerMoves, contractorMoves, engineerQuotes);
const c = report("Contractor", contractorMoves, engineerMoves, contractorQuotes);

console.log(`\nTotals: ${e.populated + c.populated}/${e.total + c.total} populated`);
