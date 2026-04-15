#!/usr/bin/env node
// CLI for the tuning loop — selects heuristic (default) or LLM proposer via TUNE_PROPOSER.
//
// Usage:
//   node scripts/tune.js                                  # heuristic, defaults
//   node scripts/tune.js --dry-run                        # 2-iter smoke, no writes
//   node scripts/tune.js --max-iters=20                   # cap iterations
//   node scripts/tune.js --max-wall-ms=300000             # cap wall-clock
//   TUNE_PROPOSER=llm node scripts/tune.js                # LLM path
//   TUNE_PROPOSER=llm node scripts/tune.js --dry-run      # LLM dry-run (real CLI calls, no writes)
//
// Env vars:
//   TUNE_PROPOSER    — "heuristic" (default) | "llm"
//   TUNE_MODEL       — LLM model ID (default claude-sonnet-4-6); only used when proposer=llm
//   TUNE_TIMEOUT_MS  — per-CLI-call timeout (default 120000); only used when proposer=llm
//   TUNE_CLAUDE_BIN  — path to the `claude` CLI executable (default "claude", resolved via PATH).
//                      Set to an absolute path on machines where Claude Code is bundled with the
//                      desktop app but not on PATH (e.g. on Windows,
//                      %APPDATA%\Claude\claude-code\<version>\claude.exe).

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import { runLoop } from "../src/tune/loop.js";
import { propose as heuristicPropose } from "../src/tune/proposer.js";
import { writeBundle, revertBundle } from "../src/tune/applyProposal.js";
import { isConverged, isImprovement } from "../src/tune/convergence.js";
import { makeGit } from "../src/tune/gitOps.js";
import { createLlmProposer } from "../src/tune/llmProposer.js";
import { createCliTransport } from "../src/tune/claudeTransport.js";

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
// --llm is CLI sugar for TUNE_PROPOSER=llm. Use this in package.json scripts
// to stay portable across shells — Windows npm shells out to cmd.exe, which
// does not understand bash-style `VAR=value cmd` env-var prefixes in script
// definitions. --llm keeps the script body shell-agnostic.
const forceLlm = process.argv.includes("--llm");
const maxIterations = flag("max-iters", 30);
const maxWallMs = flag("max-wall-ms", 45 * 60 * 1000);

function runSim() {
  // Phase 2.2e: spawn a fresh Node process per call so the sim reads the
  // current content/*.json state from disk rather than the ESM-cached
  // singletons from this process's module-init. See ROADMAP.md Phase 2.2e
  // for the cache-bug background.
  const cfg = JSON.stringify({ startSeed: 1, count: 1000, seedChunks: 3 });
  const stdout = execFileSync("node", ["scripts/tune-sim.js", cfg], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024, // 16MB — reports are small (~1-2KB) but give headroom.
  });
  return JSON.parse(stdout);
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

// Adapter: wraps the heuristic single-Proposal output into the bundle-shaped
// ProposeResult the loop expects. Ignores history/opts.
function createHeuristicAdapter(heuristicProposeFn) {
  return {
    propose(report, iteration /* , history, opts */) {
      const p = heuristicProposeFn(report, iteration);
      if (!p) return null;
      return {
        ok: true,
        bundle: {
          rule: p.rule,
          summary: p.summary,
          targets: [{ target: p.target, before: p.before, after: p.after }],
        },
      };
    },
  };
}

function selectProposer() {
  const kind = forceLlm ? "llm" : (process.env.TUNE_PROPOSER ?? "heuristic");
  if (kind === "heuristic") return createHeuristicAdapter(heuristicPropose);
  if (kind === "llm") {
    const model = process.env.TUNE_MODEL ?? "claude-sonnet-4-6";
    const timeoutMs = Number(process.env.TUNE_TIMEOUT_MS ?? 120_000);
    const executable = process.env.TUNE_CLAUDE_BIN ?? "claude";
    return createLlmProposer({ transport: createCliTransport({ model, timeoutMs, executable }) });
  }
  console.error(`Invalid TUNE_PROPOSER='${kind}' (expected 'heuristic' or 'llm')`);
  process.exit(1);
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
  proposer: selectProposer(),
  apply: { write: writeBundle, revert: revertBundle },
  convergence: { isConverged, isImprovement },
  maxIterations, maxWallMs,
  dryRun,
  log: (msg) => console.log(`[tune] ${msg}`),
});

console.log(`[tune] stopped: ${result.reason}`);
if (result.reason === "exhausted" && result.lastError) {
  console.error(`[tune] last transport error: ${result.lastError}`);
}
if (!dryRun) {
  console.log(`[tune] summary:  tuning-summary.md`);
  console.log(`[tune] next baseline: balance-baseline.next.json`);
  console.log(`[tune] run 'npm run sim:update-baseline' to accept.`);
}
