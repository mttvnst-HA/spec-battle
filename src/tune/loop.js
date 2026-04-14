// Main tuning loop. All I/O is injected — the test never touches the filesystem
// or shells out. Production callers wire in real fs, real child_process, etc.

function summarizeHistory(history, accepted) {
  // accepted is a parallel array of booleans
  const lines = [
    "# Tuning Summary",
    "",
    "| iter | worst (pp from 50%) | rule | target | before → after | accepted |",
    "|------|---------------------|------|--------|----------------|----------|",
  ];
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const worst = Math.max(...h.report.matchups.map((m) => Math.abs(m.engineerWinRate - 0.5)));
    const worstPp = (worst * 100).toFixed(2);
    const prop = h.proposal;
    const propCell = prop
      ? `${prop.rule} | ${prop.target} | ${JSON.stringify(prop.before)} → ${JSON.stringify(prop.after)}`
      : "— | — | —";
    lines.push(`| ${i} | ${worstPp} | ${propCell} | ${accepted[i] ? "yes" : "no"} |`);
  }
  return lines.join("\n") + "\n";
}

export function runLoop({
  runSim, runTests, git, fs, clock, proposer, apply, convergence,
  maxIterations = 50,
  maxWallMs = 15 * 60 * 1000,
  abortFile = ".tuning-abort",
  summaryFile = "tuning-summary.md",
  nextBaselineFile = "balance-baseline.next.json",
  dryRun = false,
  log = () => {},
}) {
  const start = clock.now();
  const history = [];   // [{ report, proposal }]
  const accepted = [];  // parallel booleans
  const iterLimit = dryRun ? Math.min(2, maxIterations) : maxIterations;

  // Baseline sim (iteration 0).
  const baseline = runSim();
  history.push({ report: baseline, proposal: null });
  accepted.push(true);
  let current = baseline;

  const finalize = (reason) => {
    if (fs.existsSync(abortFile)) fs.unlinkSync(abortFile);
    if (!dryRun) {
      fs.writeFileSync(summaryFile, summarizeHistory(history, accepted));
      fs.writeFileSync(nextBaselineFile, JSON.stringify(current, null, 2) + "\n");
    }
    return { reason, history, best: current };
  };

  for (let iter = 1; iter < iterLimit; iter++) {
    if (fs.existsSync(abortFile)) return finalize("aborted");
    if (clock.now() - start >= maxWallMs) return finalize("budget-wall");
    if (convergence.isConverged(history.map((h) => h.report))) return finalize("converged");

    const proposal = proposer.propose(current, iter - 1);
    if (!proposal) return finalize("exhausted");

    log(`iter ${iter}: ${proposal.summary}`);

    if (!dryRun) apply.write(proposal);

    const tests = runTests();
    if (!tests.ok) {
      log(`iter ${iter}: tests failed, reverting`);
      if (!dryRun) apply.revert(proposal);
      history.push({ report: current, proposal });
      accepted.push(false);
      continue;
    }

    const candidate = runSim();
    if (convergence.isImprovement(current, candidate)) {
      if (!dryRun) git.commitAll(`tune(iter-${iter}): ${proposal.summary}`);
      history.push({ report: candidate, proposal });
      accepted.push(true);
      current = candidate;
    } else {
      if (!dryRun) apply.revert(proposal);
      history.push({ report: current, proposal });
      accepted.push(false);
    }
  }

  return finalize("budget-iters");
}
