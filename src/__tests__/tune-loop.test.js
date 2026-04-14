import { describe, it, expect, vi } from "vitest";
import { runLoop } from "../tune/loop.js";

// ---- test doubles ----

function report(eng1, eng2, turns = 15) {
  return {
    matchups: [
      {
        matchup: "random-vs-random",
        engineerWinRate: eng1, contractorWinRate: 1 - eng1, drawRate: 0,
        avgTurns: turns,
        moveFrequency: { engineer: {}, contractor: {} },
      },
      {
        matchup: "random-vs-ai",
        engineerWinRate: eng2, contractorWinRate: 1 - eng2, drawRate: 0,
        avgTurns: turns,
        moveFrequency: { engineer: {}, contractor: {} },
      },
    ],
  };
}

function makeFakeFs() {
  const store = new Map();
  return {
    existsSync: (p) => store.has(p),
    readFileSync: (p) => store.get(p),
    writeFileSync: (p, data) => store.set(p, String(data)),
    unlinkSync: (p) => store.delete(p),
    _store: store,
  };
}

function makeFakeClock(start = 0, step = 100) {
  let t = start;
  return { now: () => { const v = t; t += step; return v; } };
}

function makeFakeGit() {
  const commits = [];
  return { commitAll: (msg) => commits.push(msg), _commits: commits };
}

function makeFakeConvergence() {
  return {
    isConverged: (hist) => hist.length >= 3 && hist.slice(-3).every((r) =>
      r.matchups.every((m) => m.engineerWinRate >= 0.45 && m.engineerWinRate <= 0.55),
    ),
    isImprovement: (prev, curr) => {
      const worst = (r) => Math.max(...r.matchups.map((m) => Math.abs(m.engineerWinRate - 0.5)));
      return worst(curr) < worst(prev);
    },
  };
}

// Helper: wrap a plain proposal object in the new {ok:true, bundle} shape.
function bundle(rule, target, before, after, summary) {
  return { ok: true, bundle: { rule, summary, targets: [{ target, before, after }] } };
}

describe("runLoop", () => {
  it("stops with reason='exhausted' when proposer returns null immediately", () => {
    const fs = makeFakeFs();
    const clock = makeFakeClock();
    const git = makeFakeGit();
    const apply = { write: vi.fn(), revert: vi.fn() };
    const runSim = vi.fn(() => report(0.5, 0.5));
    const runTests = vi.fn(() => ({ ok: true, output: "" }));
    const proposer = { propose: () => null };
    const convergence = makeFakeConvergence();

    const result = runLoop({
      runSim, runTests, git, fs, clock, proposer, apply, convergence,
      maxIterations: 10, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });

    expect(result.reason).toBe("exhausted");
    expect(runSim).toHaveBeenCalledTimes(1); // only baseline sim
    expect(git._commits).toHaveLength(0);
    expect(fs._store.has("summary.md")).toBe(true);
    expect(fs._store.has("next.json")).toBe(true);
  });

  it("stops with reason='aborted' when .tuning-abort exists at top of iteration", () => {
    const fs = makeFakeFs();
    fs.writeFileSync(".abort", "1");
    const clock = makeFakeClock();
    const git = makeFakeGit();
    const result = runLoop({
      runSim: () => report(0.5, 0.5),
      runTests: () => ({ ok: true }),
      git, fs, clock,
      proposer: { propose: () => null },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 10, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("aborted");
    expect(fs._store.has(".abort")).toBe(false); // loop cleans up
  });

  it("stops with reason='budget-iters' when maxIterations hits first", () => {
    const fs = makeFakeFs();
    const clock = makeFakeClock();
    const git = makeFakeGit();
    let i = 0;
    const sims = [report(0.86, 0.72), report(0.80, 0.70), report(0.76, 0.68)];
    const result = runLoop({
      runSim: () => sims[Math.min(i++, sims.length - 1)],
      runTests: () => ({ ok: true }),
      git, fs, clock,
      proposer: { propose: () => bundle("x", "GAME.mpRegen", 4, 3, "test") },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 2, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("budget-iters");
  });

  it("stops with reason='budget-wall' when wall clock hits first", () => {
    const fs = makeFakeFs();
    // Clock jumps forward by 100ms per call; wall limit is 50ms → first in-loop
    // check trips immediately after the baseline sim's clock reading at iter=1.
    const clock = makeFakeClock();
    const git = makeFakeGit();
    const result = runLoop({
      runSim: () => report(0.86, 0.72),
      runTests: () => ({ ok: true }),
      git, fs, clock,
      proposer: { propose: () => bundle("x", "GAME.mpRegen", 4, 3, "t") },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 50, maxWallMs: 50, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("budget-wall");
  });

  it("stops with reason='converged' when last 3 reports are in band", () => {
    const fs = makeFakeFs();
    const clock = makeFakeClock();
    const git = makeFakeGit();
    const sims = [report(0.86, 0.72), report(0.70, 0.60), report(0.55, 0.50), report(0.52, 0.50), report(0.50, 0.50)];
    let i = 0;
    const result = runLoop({
      runSim: () => sims[i++],
      runTests: () => ({ ok: true }),
      git, fs, clock,
      proposer: { propose: () => bundle("x", "GAME.mpRegen", 4, 3, "test") },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 50, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("converged");
    expect(git._commits.length).toBeGreaterThan(0);
    expect(git._commits[0]).toMatch(/^tune\(iter-\d+\):/);
  });

  it("reverts the proposal and skips commit when tests fail", () => {
    const fs = makeFakeFs();
    const clock = makeFakeClock();
    const git = makeFakeGit();
    const write = vi.fn();
    const revert = vi.fn();
    const sims = [report(0.86, 0.72)];
    let simCalls = 0;
    runLoop({
      runSim: () => { simCalls++; return sims[0]; },
      runTests: () => ({ ok: false, output: "test X failed" }),
      git, fs, clock,
      proposer: { propose: (_, i) => i === 0
        ? bundle("x", "GAME.mpRegen", 4, 3, "t")
        : null },
      apply: { write, revert },
      convergence: makeFakeConvergence(),
      maxIterations: 2, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(revert).toHaveBeenCalledTimes(1);
    expect(git._commits).toHaveLength(0);
    // Only the baseline sim ran (no post-apply sim, because tests failed first).
    expect(simCalls).toBe(1);
  });

  it("dryRun halts after 2 iterations and performs no git ops / file writes", () => {
    const fs = makeFakeFs();
    const clock = makeFakeClock();
    const git = makeFakeGit();
    const write = vi.fn();
    const revert = vi.fn();
    const result = runLoop({
      runSim: () => report(0.86, 0.72),
      runTests: () => ({ ok: true }),
      git, fs, clock,
      proposer: { propose: () => bundle("x", "GAME.mpRegen", 4, 3, "t") },
      apply: { write, revert },
      convergence: makeFakeConvergence(),
      maxIterations: 50, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: true, log: () => {},
    });
    expect(result.reason).toBe("budget-iters");
    expect(write).toHaveBeenCalledTimes(0);
    expect(git._commits).toHaveLength(0);
    expect(fs._store.has("summary.md")).toBe(false);
    expect(fs._store.has("next.json")).toBe(false);
  });

  it("KILL SWITCH: abort mid-run causes graceful stop + summary file", () => {
    // This is the kill-switch test the roadmap requires.
    const fs = makeFakeFs();
    const clock = makeFakeClock();
    const git = makeFakeGit();
    let iter = 0;
    const result = runLoop({
      runSim: () => {
        // After the baseline sim (iter 0), create the abort file so iter 1's
        // check-abort-at-top-of-iteration catches it.
        if (iter === 0) { fs.writeFileSync(".abort", "1"); }
        iter++;
        return report(0.86, 0.72);
      },
      runTests: () => ({ ok: true }),
      git, fs, clock,
      proposer: { propose: () => bundle("noop", "GAME.mpRegen", 4, 4, "noop") },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 50, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("aborted");
    expect(fs._store.has("summary.md")).toBe(true);
    expect(fs._store.has(".abort")).toBe(false); // loop cleaned it up
  });

  it("abort takes priority over iter-limit exhaustion", () => {
    // When iter reaches iterLimit on the same tick as abort, prefer 'aborted'.
    const fs = makeFakeFs();
    const clock = makeFakeClock();
    const git = makeFakeGit();
    let iter = 0;
    const result = runLoop({
      runSim: () => {
        // After iter 1 body, set abort. iter 2 starts: abort check first → aborted.
        if (iter === 1) fs.writeFileSync(".abort", "1");
        iter++;
        return report(0.86, 0.72);
      },
      runTests: () => ({ ok: true }),
      git, fs, clock,
      proposer: { propose: () => bundle("x", "GAME.mpRegen", 4, 4, "noop") },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 1, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("aborted");
  });

  describe("invalid-output retry", () => {
    const baseReport = { matchups: [
      { matchup: "a", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
      { matchup: "b", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
    ] };

    it("retries once when proposer returns {ok:false}, then skips if retry also fails", () => {
      const calls = [];
      const proposer = { propose: (r, i, h, opts) => {
        calls.push({ iter: i, opts });
        return { ok: false, error: "bad output" };
      }};
      const result = runLoop({
        runSim: () => baseReport,
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: { existsSync: () => false, writeFileSync: () => {}, unlinkSync: () => {} },
        clock: { now: () => 0 },
        proposer,
        apply: { write: () => {}, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => false },
        maxIterations: 2,
      });
      // iter 1: 2 calls (original + retry). iter 2: 2 calls. Total 4.
      expect(calls).toHaveLength(4);
      expect(calls[0].opts).toEqual({});
      expect(calls[1].opts).toEqual({ retryError: "bad output" });
      // Both iterations record "invalid-output".
      const invalids = result.history.filter((h) => h.outcome === "invalid-output");
      expect(invalids).toHaveLength(2);
      expect(result.reason).toBe("budget-iters");
    });

    it("retry success path: second call returns ok, loop applies bundle", () => {
      let callCount = 0;
      const proposer = { propose: () => {
        callCount++;
        if (callCount === 1) return { ok: false, error: "first fail" };
        return { ok: true, bundle: { rule: "r", summary: "s",
          targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] } };
      }};
      const writeCalls = [];
      const candidate = { matchups: baseReport.matchups.map((m) => ({ ...m, engineerWinRate: 0.49 })) };
      const result = runLoop({
        runSim: (() => { let n = 0; return () => (n++ === 0 ? baseReport : candidate); })(),
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: { existsSync: () => false, writeFileSync: () => {}, unlinkSync: () => {} },
        clock: { now: () => 0 },
        proposer,
        apply: { write: (b) => writeCalls.push(b), revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => true },
        maxIterations: 1,
      });
      expect(callCount).toBe(2);
      expect(writeCalls).toHaveLength(1);
      expect(result.history.find((h) => h.outcome === "accepted")).toBeTruthy();
    });
  });

  describe("write-failed outcome", () => {
    it("records write-failed when apply.write throws, continues to next iteration", () => {
      const baseReport = { matchups: [
        { matchup: "a", engineerWinRate: 0.6, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.6, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      const bndl = { rule: "r", summary: "s",
        targets: [{ target: "engineer.NONEXISTENT.dmg", before: [1, 2], after: [2, 3] }] };
      const result = runLoop({
        runSim: () => baseReport,
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: { existsSync: () => false, writeFileSync: () => {}, unlinkSync: () => {} },
        clock: { now: () => 0 },
        proposer: { propose: () => ({ ok: true, bundle: bndl }) },
        apply: { write: () => { throw new Error("no move named"); }, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => false },
        maxIterations: 1,
      });
      const wf = result.history.find((h) => h.outcome === "write-failed");
      expect(wf).toBeTruthy();
      expect(wf.bundle).toEqual(bndl);
    });
  });

  describe("accepted history captures worstDistanceBefore/After deltas", () => {
    it("records both distance numbers for accepted entries", () => {
      const base = { matchups: [
        { matchup: "a", engineerWinRate: 0.70, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.70, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      const after = { matchups: [
        { matchup: "a", engineerWinRate: 0.60, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.60, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      let n = 0;
      const result = runLoop({
        runSim: () => (n++ === 0 ? base : after),
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: { existsSync: () => false, writeFileSync: () => {}, unlinkSync: () => {} },
        clock: { now: () => 0 },
        proposer: { propose: () => ({ ok: true,
          bundle: { rule: "r", summary: "s",
            targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] } }) },
        apply: { write: () => {}, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => true },
        maxIterations: 1,
      });
      const accepted = result.history.find((h) => h.outcome === "accepted");
      expect(accepted.worstDistanceBefore).toBeCloseTo(0.20, 6);
      expect(accepted.worstDistanceAfter).toBeCloseTo(0.10, 6);
      expect(accepted.worstDistanceCandidate).toBeCloseTo(0.10, 6);
    });
  });

  describe("worstDistanceCandidate on not-improvement", () => {
    it("captures the candidate distance even when the bundle is rejected", () => {
      const base = { matchups: [
        { matchup: "a", engineerWinRate: 0.70, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.70, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      // Candidate is a "close miss" — slightly worse than current (so isImprovement fails)
      // but we still want the distance recorded.
      const worseCandidate = { matchups: [
        { matchup: "a", engineerWinRate: 0.71, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.71, avgTurns: 12, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      let n = 0;
      const result = runLoop({
        runSim: () => (n++ === 0 ? base : worseCandidate),
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: { existsSync: () => false, writeFileSync: () => {}, unlinkSync: () => {} },
        clock: { now: () => 0 },
        proposer: { propose: () => ({ ok: true,
          bundle: { rule: "r", summary: "s",
            targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] } }) },
        apply: { write: () => {}, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => false },
        maxIterations: 1,
      });
      const notImp = result.history.find((h) => h.outcome === "not-improvement");
      expect(notImp.worstDistanceBefore).toBeCloseTo(0.20, 6);
      expect(notImp.worstDistanceCandidate).toBeCloseTo(0.21, 6);
      // not-improvement never records worstDistanceAfter:
      expect(notImp.worstDistanceAfter).toBeUndefined();
    });
  });
});
