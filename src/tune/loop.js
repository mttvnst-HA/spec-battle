// Main tuning loop. All I/O is injected — the test never touches the filesystem
// or shells out. Production callers wire in real fs, real child_process, etc.

function worstDistance(report) {
  return Math.max(...report.matchups.map((m) => Math.abs(m.engineerWinRate - 0.5)));
}

function summarizeHistory(history) {
  const lines = [
    "# Tuning Summary",
    "",
    "| iter | outcome | worst (pp) | rule | summary |",
    "|------|---------|-----------|------|---------|",
  ];
  for (const h of history) {
    const worstBefore = h.worstDistanceBefore ?? worstDistance(h.report);
    const worstPp = (worstBefore * 100).toFixed(2);
    const rule = h.bundle?.rule ?? "—";
    const summary = h.bundle?.summary ?? "—";
    lines.push(`| ${h.iteration} | ${h.outcome} | ${worstPp} | ${rule} | ${summary} |`);
  }
  return lines.join("\n") + "\n";
}

export function runLoop({
  runSim, runTests, git, fs, clock, proposer, apply, convergence,
  maxIterations = 30,
  maxWallMs = 45 * 60 * 1000,
  abortFile = ".tuning-abort",
  summaryFile = "tuning-summary.md",
  nextBaselineFile = "balance-baseline.next.json",
  dryRun = false,
  log = () => {},
}) {
  const start = clock.now();
  const history = [];
  const iterLimit = dryRun ? Math.min(2, maxIterations) : maxIterations;

  // Baseline sim (iteration 0).
  const baseline = runSim();
  history.push({ iteration: 0, bundle: null, outcome: "baseline", report: baseline });
  let current = baseline;

  const finalize = (reason) => {
    if (fs.existsSync(abortFile)) fs.unlinkSync(abortFile);
    if (!dryRun) {
      fs.writeFileSync(summaryFile, summarizeHistory(history));
      fs.writeFileSync(nextBaselineFile, JSON.stringify(current, null, 2) + "\n");
    }
    return { reason, history, best: current };
  };

  // Runs one propose call with optional retryError. Returns whatever the
  // proposer returns — expected to be a ProposeResult ({ok:true, bundle} |
  // {ok:false, error}) or null for non-recoverable transport failure. Callers
  // handle all three shapes explicitly; no error handling here.
  const callPropose = (iter, opts) => proposer.propose(current, iter - 1, history, opts);

  for (let iter = 1; ; iter++) {
    if (fs.existsSync(abortFile)) return finalize("aborted");
    if (clock.now() - start >= maxWallMs) return finalize("budget-wall");
    if (iter > iterLimit) return finalize("budget-iters");
    if (convergence.isConverged(history.map((h) => h.report))) return finalize("converged");

    let result = callPropose(iter, {});
    if (result === null) return finalize("exhausted");
    if (result.ok === false) {
      log(`iter ${iter}: invalid output (${result.error}) — retrying once`);
      result = callPropose(iter, { retryError: result.error });
      if (result === null || result.ok === false) {
        const err = result === null ? "proposer returned null on retry" : result.error;
        log(`iter ${iter}: retry also failed (${err}); skipping iteration`);
        history.push({
          iteration: iter,
          bundle: null,
          outcome: "invalid-output",
          report: current,
          worstDistanceBefore: worstDistance(current),
        });
        continue;
      }
    }
    const bundle = result.bundle;
    log(`iter ${iter}: ${bundle.summary}`);

    if (!dryRun) {
      try {
        apply.write(bundle);
      } catch (err) {
        log(`iter ${iter}: write failed (${err.message}); skipping`);
        history.push({
          iteration: iter,
          bundle,
          outcome: "write-failed",
          report: current,
          worstDistanceBefore: worstDistance(current),
        });
        continue;
      }
    }

    const tests = runTests();
    if (!tests.ok) {
      log(`iter ${iter}: tests failed, reverting`);
      if (!dryRun) apply.revert(bundle);
      history.push({
        iteration: iter,
        bundle,
        outcome: "tests-failed",
        report: current,
        worstDistanceBefore: worstDistance(current),
      });
      continue;
    }

    const candidate = runSim();
    if (convergence.isImprovement(current, candidate)) {
      if (!dryRun) git.commitAll(`tune(iter-${iter}): ${bundle.summary}`);
      history.push({
        iteration: iter,
        bundle,
        outcome: "accepted",
        report: candidate,
        worstDistanceBefore: worstDistance(current),
        worstDistanceAfter: worstDistance(candidate),
      });
      current = candidate;
    } else {
      if (!dryRun) apply.revert(bundle);
      history.push({
        iteration: iter,
        bundle,
        outcome: "not-improvement",
        report: current,
        worstDistanceBefore: worstDistance(current),
      });
    }
  }
}
