# Phase 2.2c — Sim Noise Floor + Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the sim-noise-vs-step-size ceiling revealed by the Phase 2.2b production LLM tune. Raise default sim count from 200 to 1000, add `worstDistanceCandidate` to history entries, surface transport errors in `tuning-summary.md`. No proposer-logic changes — Phase 2.2c is a measurement/observability phase.

**Architecture:** Mechanical edits to `scripts/simulate.js`, `scripts/tune.js`, `src/tune/loop.js`, `src/tune/llmProposer.js`. No new modules. Baseline regenerated as a separate human-approved commit. Loop continues to never write `balance-baseline.json` directly.

**Tech Stack:** JavaScript (ES modules), Vite, Vitest. Node ≥22. No new dependencies.

**Why no TDD:** 2.2c is a measurement + observability phase. Most changes are additive (new history fields, new summary section, larger sim count). Test updates are mechanical and follow the code changes. Verification loop is "run `npm test` after each task, expect green".

---

## File Structure

**Modified:**
- `scripts/simulate.js` — `flag("count", 200)` → `flag("count", 1000)` (Task 1).
- `scripts/tune.js` — `runSim()` helper's `const count = 200` → `const count = 1000` (Task 1).
- `balance-baseline.json` — regenerated via `npm run sim:update-baseline` at the new default (Task 2, separate commit).
- `src/tune/loop.js` — capture `worstDistanceCandidate` into `accepted` and `not-improvement` history entries; update `summarizeHistory` column layout; wire transport-error surfacing on `exhausted` exits (Tasks 3, 5).
- `src/tune/llmProposer.js` — include `worstDistanceCandidate` in history-entry prompt serialization; add `lastError` getter to `createLlmProposer` (Tasks 4, 5).
- `src/__tests__/tune-loop.test.js` — extend accepted-delta test + add not-improvement candidate test + transport-error surfacing test (Tasks 3, 5).
- `src/__tests__/tune-llmProposer-prompt.test.js` — fixture test for candidate-distance in not-improvement history entries (Task 4).
- `src/__tests__/tune-llmProposer-propose.test.js` — `lastError` getter behavior test (Task 5).
- `CLAUDE.md` — Tuning harness subsection notes the new 1000-game default + transport error surfacing (Task 6).

**Not modified:**
- `src/tune/proposer.js` (heuristic rule library).
- `src/tune/applyProposal.js` (bundle apply/revert).
- `src/tune/convergence.js` (`isConverged`, `isImprovement` strict gate stays).
- `src/tune/claudeTransport.js` (transport layer unchanged; error still thrown, capture happens at createLlmProposer layer).
- `src/sim/` modules (runBatch parameter-driven; callers change defaults).
- `vitest.config.js`.

---

## Design Contracts

### `worstDistanceCandidate` history field

```js
/**
 * History entry extension (Phase 2.2c):
 * @property {number|undefined} worstDistanceCandidate
 *   - Present on "accepted" and "not-improvement" outcomes (when runSim() ran).
 *   - Absent on "baseline", "tests-failed", "invalid-output", "write-failed".
 *   - Value: Math.max(...candidate.matchups.map(m => Math.abs(m.engineerWinRate - 0.5)))
 *   - Captured BEFORE the isImprovement check — always populated when we have a candidate report, even if it's about to be rejected.
 */
```

Rationale: `worstDistanceBefore` shows where current was; `worstDistanceCandidate` shows where the proposed bundle got us. The gap between them tells us whether the bundle was a close miss or way off — visible in `tuning-summary.md` and in the LLM's prompt history.

### Proposer `lastError` getter (optional protocol)

```js
/**
 * Optional proposer capability. Loop reads proposer.lastError on "exhausted"
 * finalize; if truthy, appends to tuning-summary.md.
 *
 * createLlmProposer implements:
 *   - Cleared to null on successful propose() (including retry-success).
 *   - Set to transport error message on transport.send throw.
 *   - Still null after a parseBundle failure — parse failures are loop-level
 *     "invalid-output" outcomes, not transport failures.
 *
 * createHeuristicAdapter does NOT implement. Loop handles undefined gracefully.
 */
```

### `summarizeHistory` column layout (Phase 2.2c)

```
| iter | outcome | worst before | worst candidate | rule | summary |
|------|---------|--------------|-----------------|------|---------|
| 0 | baseline | 36.50 | — | — | — |
| 1 | not-improvement | 36.50 | 36.20 | ... | ... |
| 2 | accepted | 36.50 | 33.10 | ... | ... |
| 3 | tests-failed | 33.10 | — | ... | ... |
```

Rationale: existing column was labeled "worst (pp)" and showed `worstDistanceBefore`. Renamed for clarity + new column inserted. `—` dash for absent values. This makes the Phase 2.1 ceiling analysis pattern ("every iteration shows worst=36.50") distinguishable from "candidate actually shifted but not enough" — which is exactly the Phase 2.2b finding we need to diagnose going forward.

### Exhausted-exit summary footer

When `reason === "exhausted"` AND `proposer.lastError` is a non-empty string, append to the summary after the history table:

```markdown

## Last transport error

<error message, verbatim>
```

Single-blank-line separation before the `##` so markdown renders cleanly. Only emitted on `exhausted` exits — other reasons (`converged`, `budget-iters`, `budget-wall`, `aborted`) don't carry a transport-error interpretation.

### Loop return value extension

`runLoop` return shape gains an optional `lastError` field:

```js
return { reason, history, best: current, lastError: proposer.lastError ?? null };
```

Tests and `scripts/tune.js` read it idiomatically. Null when no error or when proposer doesn't implement `lastError`.

### Sim size default (1000)

The `count` parameter to `runBatch` stays untyped/unconstrained — it's the caller's default that changes:

- `scripts/simulate.js` line 27: `flag("count", 200)` → `flag("count", 1000)`.
- `scripts/tune.js` line ~48 (inside `runSim()`): `const count = 200` → `const count = 1000`.

Callers that pass `--count=N` explicitly are unaffected. Internal `runBatch` callers not going through these scripts (e.g., `balance-regression.test.js` using `baselineMatchup.count`) are unaffected until the baseline itself is regenerated.

---

## Task 1: Sim size default 200 → 1000

Two-file mechanical change. Tests stay green because `balance-regression.test.js` uses the count embedded in `balance-baseline.json` (still 200 after this task), and tune-loop tests use mock `runSim`s that don't hit the real default.

**Files:**
- Modify: `scripts/simulate.js` (line 27)
- Modify: `scripts/tune.js` (inside `runSim()`)

- [ ] **Step 1: Confirm current values**

Run: Read `scripts/simulate.js` and grep for `flag("count"` — confirm the value is `200`.
Run: Read `scripts/tune.js` and grep for `const count` — confirm the value is `200`.

- [ ] **Step 2: Update `scripts/simulate.js`**

Change this line:

```js
const count = flag("count", 200);
```

to:

```js
const count = flag("count", 1000);
```

- [ ] **Step 3: Update `scripts/tune.js`**

Inside the `runSim()` function (around line 48), change:

```js
function runSim() {
  const count = 200;
  const startSeed = 1;
```

to:

```js
function runSim() {
  const count = 1000;
  const startSeed = 1;
```

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: all 324 tests still pass. The balance regression test uses `baselineMatchup.count` (the value embedded in the current `balance-baseline.json`, which is still `200`), so it runs 200-game sims comparing to 200-game baseline — no drift.

If `npm test` fails, inspect the failure. It should NOT fail here — if it does, diagnose and STOP (escalate to NEEDS_CONTEXT). Do not proceed to Step 5 with a broken tree.

- [ ] **Step 5: Verify heuristic dry-run still works (and is now slower)**

Run: `npm run tune:dry-run`
Expected: runs 2 iterations, exits `stopped: budget-iters`. Noticeably slower than before — ~3-5× per-iteration time because sim is 1000 games instead of 200. This is the expected tradeoff; no action needed.

- [ ] **Step 6: Commit**

```bash
git add scripts/simulate.js scripts/tune.js
git commit -m "feat(sim): raise default matchup size from 200 to 1000 games

Phase 2.2c Task 1. Reduces standard error on random-vs-random engineer
winrate from ~2.4pp (at p=0.865, n=200) to ~1.08pp (at n=1000), below
the expected post-tweak signal band. Step-size bounds stay at
±1 dmg / ±0.02 rate — tighter measurement, not bigger moves.

scripts/simulate.js and scripts/tune.js both updated. Callers passing
explicit --count=N are unaffected.

balance-regression.test.js uses baselineMatchup.count (embedded in
balance-baseline.json, still 200 at this commit). Regeneration of the
baseline is a separate commit (Task 2) per ROADMAP AC — human runs
\`npm run sim:update-baseline\` to accept the new baseline at the new
default.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Regenerate `balance-baseline.json` at the new default

Human-approved baseline regeneration. Runs the committed `sim:update-baseline` script (which now defaults to 1000 games after Task 1) and commits the resulting file as a separate commit.

**Files:**
- Modify: `balance-baseline.json` (full regeneration)

- [ ] **Step 1: Regenerate the baseline**

Run: `npm run sim:update-baseline`
Expected: writes `balance-baseline.json` with `"count": 1000` in both matchup objects. The numeric values (engineerWinRate, avgTurns, moveFrequency) will be close to — but likely not identical to — the previous values, because tighter sampling reduces variance.

- [ ] **Step 2: Inspect the diff**

Run: `git diff balance-baseline.json`
Expected changes:
- Both matchup objects now have `"count": 1000`.
- `engineerWinRate` values should stay in the ~0.86 / ~0.72 neighborhood (baseline is deterministic given seed=1).
- `moveFrequency` entries may shift by up to ~1pp per move due to the larger sample.

If any value shifts dramatically (e.g., engineerWinRate moves from 0.86 to 0.7), something is wrong — STOP and escalate. The seeded xorshift32 should produce deterministic results; a large shift means a non-determinism leak or a sim-harness bug, which is out of Phase 2.2c scope.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass. `balance-regression.test.js` now runs 1000-game sims (per new `baselineMatchup.count`) and compares them to 1000-game baselines. Because the loop is deterministic under seed=1, the regression delta should be essentially zero — well within the ±0.5pp tolerance.

If tests fail, diagnose:
- Timeout? The 1000-game regression check runs inside `npm test` and may need a couple extra seconds. Rerun once to rule out noise.
- Actual drift beyond tolerance? Likely a sim-harness bug. STOP and escalate.

- [ ] **Step 4: Commit the regenerated baseline**

```bash
git add balance-baseline.json
git commit -m "chore(baseline): regenerate balance-baseline.json at 1000 games/matchup

Phase 2.2c Task 2. Human-approved baseline regeneration following the
sim-size default bump in Task 1. Ran \`npm run sim:update-baseline\`
with the new 1000-game default; committed the result verbatim.

Standard error drops from ~2.4pp to ~1.08pp on random-vs-random engineer
winrate. Per-move frequency sampling also tightens. Seeded xorshift32
makes the new baseline deterministic under seed=1; any future
regeneration must match this file byte-for-byte unless content/*.json
changes.

balance-regression.test.js reads baselineMatchup.count from this file,
so it now runs 1000-game regression checks automatically.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Capture `worstDistanceCandidate` in history + summary column

Adds the new history field on `accepted` and `not-improvement` outcomes. Updates `summarizeHistory` to render a new column. Extends `tune-loop.test.js`.

**Files:**
- Modify: `src/tune/loop.js`
- Modify: `src/__tests__/tune-loop.test.js`

- [ ] **Step 1: Read current `src/tune/loop.js` structure**

Run: Read `src/tune/loop.js` in full. Confirm the structure matches the Phase 2.2b version:
- `worstDistance(report)` helper exists.
- `summarizeHistory(history)` emits a markdown table.
- The `for (let iter = 1; ; iter++)` loop has the full propose → apply → test → sim → improvement-check flow.

Note the exact lines where `history.push({ ... })` is called for `accepted` and `not-improvement` outcomes — you'll modify those.

- [ ] **Step 2: Modify the candidate capture + history pushes**

Find the `const candidate = runSim();` line (near the bottom of the iteration body). Immediately after it, capture the worst candidate distance:

```js
    const candidate = runSim();
    const candidateDistance = worstDistance(candidate);
    if (convergence.isImprovement(current, candidate)) {
      if (!dryRun) git.commitAll(`tune(iter-${iter}): ${bundle.summary}`);
      history.push({
        iteration: iter,
        bundle,
        outcome: "accepted",
        report: candidate,
        worstDistanceBefore: worstDistance(current),
        worstDistanceAfter: candidateDistance,
        worstDistanceCandidate: candidateDistance,
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
        worstDistanceCandidate: candidateDistance,
      });
    }
```

Note `worstDistanceAfter` on the `accepted` entry now reuses `candidateDistance` (they're the same value — `worstDistance(candidate)`). This is a minor internal cleanup, not a semantic change.

Do NOT add `worstDistanceCandidate` to `baseline`, `tests-failed`, `invalid-output`, or `write-failed` pushes — those outcomes didn't run a candidate sim, so the field stays `undefined`.

- [ ] **Step 3: Update `summarizeHistory` column layout**

Replace the current body of `summarizeHistory`:

```js
function summarizeHistory(history) {
  const lines = [
    "# Tuning Summary",
    "",
    "| iter | outcome | worst before | worst candidate | rule | summary |",
    "|------|---------|--------------|-----------------|------|---------|",
  ];
  for (const h of history) {
    const worstBefore = h.worstDistanceBefore ?? worstDistance(h.report);
    const worstBeforePp = (worstBefore * 100).toFixed(2);
    const worstCandPp = h.worstDistanceCandidate !== undefined
      ? (h.worstDistanceCandidate * 100).toFixed(2)
      : "—";
    const rule = h.bundle?.rule ?? "—";
    const summary = h.bundle?.summary ?? "—";
    lines.push(`| ${h.iteration} | ${h.outcome} | ${worstBeforePp} | ${worstCandPp} | ${rule} | ${summary} |`);
  }
  return lines.join("\n") + "\n";
}
```

Keep the `worstDistance(h.report)` fallback for the baseline entry (it has no `worstDistanceBefore`).

- [ ] **Step 4: Update the accepted-delta-capture test**

In `src/__tests__/tune-loop.test.js`, find the test block `describe("accepted history captures worstDistanceBefore/After deltas", ...)` (near the end of the file).

Extend the test to also assert the new field:

```js
      const accepted = result.history.find((h) => h.outcome === "accepted");
      expect(accepted.worstDistanceBefore).toBeCloseTo(0.20, 6);
      expect(accepted.worstDistanceAfter).toBeCloseTo(0.10, 6);
      expect(accepted.worstDistanceCandidate).toBeCloseTo(0.10, 6);
```

- [ ] **Step 5: Add a new test for `worstDistanceCandidate` on not-improvement outcomes**

Append inside the same describe block (or create a new describe block at the end):

```js
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
```

- [ ] **Step 6: Update the `summarizeHistory` expectations, if any tests assert on its output**

Grep `src/__tests__/tune-loop.test.js` for `summarizeHistory` or `tuning-summary`. If any test asserts on the specific column header string `"worst (pp)"` (the old name), update to `"worst before"`. If none do, no change needed.

The 2.2b test suite does not assert on the rendered summary string directly — `summarizeHistory` is called inside `finalize()` with `fs.writeFileSync`, and tests mock `fs.writeFileSync` to a no-op. If this is still the case after reading, annotate this step as "no test changes needed".

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests pass. Count unchanged (+1 new test for not-improvement candidate). Was 324 at end of Task 2; now 325.

- [ ] **Step 8: Commit**

```bash
git add src/tune/loop.js src/__tests__/tune-loop.test.js
git commit -m "feat(tune): record worstDistanceCandidate on accepted + not-improvement

Phase 2.2c Task 3. Captures the worst-matchup distance of every sim'd
candidate, not just the one that got accepted. Previously the summary
showed worst-before only — a not-improvement outcome gave no signal
whether the bundle was a close miss (worst-candidate 36.30) or way off
(worst-candidate 42.10), making post-run ceiling analysis guesswork.

New history field: worstDistanceCandidate (number | undefined). Present
on 'accepted' and 'not-improvement' outcomes; absent on baseline,
tests-failed, invalid-output, write-failed.

summarizeHistory gains a new column 'worst candidate'; the existing
'worst (pp)' column renamed 'worst before' for clarity. Same
markdown-table format.

Tests: existing accepted-delta test extended to assert the new field;
new not-improvement test covers the close-miss case.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: LlmProposer prompt embeds candidate distance

`buildPrompt` currently filters history to last-3 non-baseline entries and includes `worstDistanceBefore`/`worstDistanceAfter` conditionally. Extend the serialization to also include `worstDistanceCandidate` when present — so the LLM sees how close its prior bundles came.

**Files:**
- Modify: `src/tune/llmProposer.js` (buildPrompt dynamic history serialization)
- Modify: `src/__tests__/tune-llmProposer-prompt.test.js`

- [ ] **Step 1: Read current `buildPrompt` history serialization**

Run: Read `src/tune/llmProposer.js`, focus on the `buildPrompt` function. Find the section that builds `recent` entries and their JSON serialization — near the bottom of the dynamic section. Look for `worstDistanceBefore`/`worstDistanceAfter` conditional additions.

- [ ] **Step 2: Add `worstDistanceCandidate` to the serialization**

In the `history.filter(...).slice(-3).map(...)` callback, extend the entry transform to also include the candidate distance when present. The pattern matches the existing Before/After additions:

```js
    dynamicParts.push(JSON.stringify(recent.map((h) => {
      const entry = { iteration: h.iteration, bundle: h.bundle, outcome: h.outcome };
      if (h.worstDistanceBefore !== undefined) entry.worstDistanceBefore = +h.worstDistanceBefore.toFixed(4);
      if (h.worstDistanceAfter !== undefined) entry.worstDistanceAfter = +h.worstDistanceAfter.toFixed(4);
      if (h.worstDistanceCandidate !== undefined) entry.worstDistanceCandidate = +h.worstDistanceCandidate.toFixed(4);
      return entry;
    }), null, 2));
```

Add the `worstDistanceCandidate` line AFTER the `worstDistanceAfter` line (order matters for test assertions and for human readability of the prompt).

- [ ] **Step 3: Add a fixture test for candidate-distance in not-improvement entries**

In `src/__tests__/tune-llmProposer-prompt.test.js`, find the existing test `"embeds last 3 non-baseline history entries in oldest-first order"` (around line 55-80). It currently asserts `"worstDistanceAfter": 0.28` appears for the accepted entry.

Extend it to also assert the new field:

```js
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history });
    // Last 3 after filtering baseline: entries 2, 3, 4
    expect(out).toContain('"iteration": 2');
    expect(out).toContain('"iteration": 3');
    expect(out).toContain('"iteration": 4');
    expect(out).not.toContain('"iteration": 1');
    expect(out).not.toContain('"iteration": 0');
    // Delta signal present on accepted entries
    expect(out).toContain('"worstDistanceAfter": 0.28');
    // No worstDistanceAfter on non-improvement
    const idx = out.indexOf('"iteration": 3');
    const until = out.indexOf('"iteration": 4');
    expect(out.slice(idx, until)).not.toContain('"worstDistanceAfter"');
```

Update the test's `mkEntry` invocations to include `worstDistanceCandidate` on the iteration-3 (not-improvement) and iteration-4 (accepted) entries so the serializer has something to write. Find the existing `history` construction near the top of the test:

```js
    const history = [
      { iteration: 0, bundle: null, outcome: "baseline", report: baseReport },
      mkEntry(1, "tests-failed", { worstDistanceBefore: 0.365 }),
      mkEntry(2, "accepted", { worstDistanceBefore: 0.365, worstDistanceAfter: 0.320 }),
      mkEntry(3, "not-improvement", { worstDistanceBefore: 0.320 }),
      mkEntry(4, "accepted", { worstDistanceBefore: 0.320, worstDistanceAfter: 0.280 }),
    ];
```

Change to add candidates on the relevant entries:

```js
    const history = [
      { iteration: 0, bundle: null, outcome: "baseline", report: baseReport },
      mkEntry(1, "tests-failed", { worstDistanceBefore: 0.365 }),
      mkEntry(2, "accepted", { worstDistanceBefore: 0.365, worstDistanceAfter: 0.320, worstDistanceCandidate: 0.320 }),
      mkEntry(3, "not-improvement", { worstDistanceBefore: 0.320, worstDistanceCandidate: 0.315 }),
      mkEntry(4, "accepted", { worstDistanceBefore: 0.320, worstDistanceAfter: 0.280, worstDistanceCandidate: 0.280 }),
    ];
```

Then add new assertions at the end of the existing test (after the existing `worstDistanceAfter` check), before the closing `});`:

```js
    // Candidate distance present for accepted AND not-improvement
    expect(out).toContain('"worstDistanceCandidate": 0.315');   // entry 3 (not-improvement)
    expect(out).toContain('"worstDistanceCandidate": 0.28');    // entry 4 (accepted)
```

- [ ] **Step 4: Run the prompt test file in isolation**

Run: `npx vitest run src/__tests__/tune-llmProposer-prompt.test.js`
Expected: 8 tests pass (unchanged count — we extended an existing test, didn't add one). Assertions about the new `worstDistanceCandidate` string presence pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass, count 325 (same as Task 3's end state — no new tests this task).

- [ ] **Step 6: Commit**

```bash
git add src/tune/llmProposer.js src/__tests__/tune-llmProposer-prompt.test.js
git commit -m "feat(tune): LLM prompt history includes worstDistanceCandidate

Phase 2.2c Task 4. buildPrompt now serializes the new
worstDistanceCandidate field into history entries when present
(accepted + not-improvement outcomes). Gives the LLM direct visibility
into how close its prior bundles came to the improvement gate — not
just accepted-vs-rejected, but by how much.

Field ordering in the serialized history entry: before → after →
candidate. Accepted entries show all three (after === candidate when
the bundle was accepted). Not-improvement entries show before +
candidate only.

Fixture test extended to assert the new field is present for both
accepted and not-improvement entries.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Transport-error capture + summary rendering

Two-file coordination: `createLlmProposer` gains a `lastError` getter; `runLoop` reads it on `finalize("exhausted")` and appends to the summary + return value.

**Files:**
- Modify: `src/tune/llmProposer.js` (createLlmProposer — add closure state)
- Modify: `src/tune/loop.js` (finalize — surface proposer.lastError)
- Modify: `src/__tests__/tune-llmProposer-propose.test.js`
- Modify: `src/__tests__/tune-loop.test.js`

- [ ] **Step 1: Add `lastError` state + getter to `createLlmProposer`**

In `src/tune/llmProposer.js`, find the `createLlmProposer` function (appended at the end of the file in Phase 2.2b Task 6). Replace its body with:

```js
export function createLlmProposer({ transport, getCurrentState = readConfig }) {
  let lastError = null;
  return {
    get lastError() { return lastError; },
    propose(report, iteration, history, opts = {}) {
      const currentState = getCurrentState();
      const prompt = buildPrompt({
        currentState,
        currentReport: report,
        history: history ?? [],
        retryError: opts.retryError,
      });

      let raw;
      try {
        raw = transport.send(prompt);
      } catch (err) {
        // Non-recoverable transport failure (CLI missing, timeout, etc.).
        // Surface the error for the loop's exhausted-exit summary, then
        // return null so the loop stops with reason "exhausted".
        lastError = (err && err.message) ? err.message : String(err);
        return null;
      }
      // Transport success — clear any prior error so the loop doesn't
      // surface stale state if a later iteration exhausts for a different
      // reason (null from exhausted budget, etc.).
      lastError = null;
      return parseBundle(raw, currentState);
    },
  };
}
```

The closure variable `lastError` persists across `propose` calls for the lifetime of the proposer instance. Getter pattern keeps it read-only from outside.

- [ ] **Step 2: Read current `src/tune/loop.js` `finalize` implementation**

Run: Read `src/tune/loop.js`, focus on the `finalize` closure. Note:
- It takes a `reason` string.
- It cleans up the abort file.
- In non-dryRun mode, writes `summaryFile` (via `summarizeHistory(history)`) and `nextBaselineFile`.
- Returns `{ reason, history, best: current }`.

- [ ] **Step 3: Modify `finalize` to surface transport errors**

Replace the `finalize` body with:

```js
  const finalize = (reason) => {
    if (fs.existsSync(abortFile)) fs.unlinkSync(abortFile);
    // Surface the most recent transport error (if any) on "exhausted" exits.
    // Proposers without lastError (heuristic adapter) expose undefined; treat as null.
    const lastError = (reason === "exhausted" && proposer.lastError) ? proposer.lastError : null;
    if (!dryRun) {
      let summary = summarizeHistory(history);
      if (lastError) {
        summary += `\n## Last transport error\n\n${lastError}\n`;
      }
      fs.writeFileSync(summaryFile, summary);
      fs.writeFileSync(nextBaselineFile, JSON.stringify(current, null, 2) + "\n");
    }
    return { reason, history, best: current, lastError };
  };
```

Note the summary appends a blank line before `## Last transport error` (inside the template literal, the `\n\n` after the history-table output) to keep markdown rendering clean.

- [ ] **Step 4: Add `lastError` test to `tune-llmProposer-propose.test.js`**

Append inside the `describe("createLlmProposer.propose", ...)` block:

```js
  it("exposes lastError after a transport throw, clears on next success", () => {
    let throwNext = true;
    const send = vi.fn((prompt) => {
      if (throwNext) throw new Error("ENOENT: claude not found");
      return JSON.stringify({ type: "result", result: JSON.stringify(validBundle) });
    });
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });

    // First call: transport throws, propose returns null, lastError is set.
    expect(proposer.propose(report, 0, [])).toBeNull();
    expect(proposer.lastError).toBe("ENOENT: claude not found");

    // Second call: transport succeeds, propose returns ok, lastError cleared.
    throwNext = false;
    const r = proposer.propose(report, 1, []);
    expect(r.ok).toBe(true);
    expect(proposer.lastError).toBeNull();
  });

  it("lastError is null on a fresh proposer (no propose calls yet)", () => {
    const send = vi.fn();
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    expect(proposer.lastError).toBeNull();
  });

  it("lastError stays null when propose returns {ok:false} from parse failure (not a transport failure)", () => {
    const send = vi.fn(() => "garbage no json");
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const r = proposer.propose(report, 0, []);
    expect(r.ok).toBe(false);
    expect(proposer.lastError).toBeNull();
  });
```

- [ ] **Step 5: Add loop-level test for transport-error surfacing**

Append inside `src/__tests__/tune-loop.test.js`, in a new describe block at the end:

```js
  describe("exhausted exit surfaces proposer.lastError", () => {
    it("writes the error into the summary and includes it in the return value", () => {
      const baseReport = { matchups: [
        { matchup: "a", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      const writes = {};
      const proposer = {
        lastError: "ETIMEDOUT: claude timed out after 120000ms",
        propose: () => null,
      };
      const result = runLoop({
        runSim: () => baseReport,
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: {
          existsSync: () => false,
          writeFileSync: (path, content) => { writes[path] = content; },
          unlinkSync: () => {},
        },
        clock: { now: () => 0 },
        proposer,
        apply: { write: () => {}, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => false },
        maxIterations: 5,
      });
      expect(result.reason).toBe("exhausted");
      expect(result.lastError).toBe("ETIMEDOUT: claude timed out after 120000ms");
      // Summary file contains the error section.
      expect(writes["tuning-summary.md"]).toMatch(/## Last transport error/);
      expect(writes["tuning-summary.md"]).toContain("ETIMEDOUT: claude timed out after 120000ms");
    });

    it("does NOT surface lastError on non-exhausted exits", () => {
      // Converged/budget-iters/budget-wall exits don't have a transport-error
      // interpretation even if proposer has lastError set.
      const baseReport = { matchups: [
        { matchup: "a", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      const writes = {};
      const proposer = {
        lastError: "stale error from a prior call",
        propose: () => ({ ok: true, bundle: { rule: "r", summary: "s",
          targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] } }),
      };
      const result = runLoop({
        runSim: () => baseReport,
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: {
          existsSync: () => false,
          writeFileSync: (path, content) => { writes[path] = content; },
          unlinkSync: () => {},
        },
        clock: { now: () => 0 },
        proposer,
        apply: { write: () => {}, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => false },
        maxIterations: 1,
      });
      expect(result.reason).toBe("budget-iters");
      expect(result.lastError).toBeNull();
      expect(writes["tuning-summary.md"]).not.toMatch(/## Last transport error/);
    });

    it("handles proposers without lastError (heuristic adapter) gracefully", () => {
      const baseReport = { matchups: [
        { matchup: "a", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
        { matchup: "b", engineerWinRate: 0.5, avgTurns: 10, moveFrequency: { engineer: {}, contractor: {} } },
      ] };
      const writes = {};
      // proposer does NOT expose lastError — simulates the heuristic adapter.
      const proposer = { propose: () => null };
      const result = runLoop({
        runSim: () => baseReport,
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: {
          existsSync: () => false,
          writeFileSync: (path, content) => { writes[path] = content; },
          unlinkSync: () => {},
        },
        clock: { now: () => 0 },
        proposer,
        apply: { write: () => {}, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => false },
        maxIterations: 5,
      });
      expect(result.reason).toBe("exhausted");
      expect(result.lastError).toBeNull();
      expect(writes["tuning-summary.md"]).not.toMatch(/## Last transport error/);
    });
  });
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass. Count delta:
- Task 5 adds 3 tests to `tune-llmProposer-propose.test.js` (lastError transport throw + clear, fresh proposer null, parse-failure null).
- Task 5 adds 3 tests to `tune-loop.test.js` (exhausted surfaces lastError, non-exhausted doesn't, no-lastError proposer graceful).

Was 325 at end of Task 3 → after Task 4 (still 325) → after Task 5: 325 + 6 = **331 tests**.

- [ ] **Step 7: Commit**

```bash
git add src/tune/llmProposer.js src/tune/loop.js src/__tests__/tune-llmProposer-propose.test.js src/__tests__/tune-loop.test.js
git commit -m "feat(tune): surface transport errors on exhausted exits

Phase 2.2c Task 5. Two-layer capture: createLlmProposer now maintains
a lastError closure variable (set on transport.send throw, cleared on
success) exposed via a read-only getter. runLoop reads
proposer.lastError on finalize('exhausted') and:

- appends a '## Last transport error' section to tuning-summary.md
- includes lastError in the runLoop return value

Fixes the Phase 2.2b observability gap: when the production tune
exited 'exhausted' after 8 iterations, nothing surfaced why. Was it
a rate limit? A quota? CLI missing? Now the summary carries the
transport's error message verbatim — likely 'ETIMEDOUT', a 429
body from an HTTP error string, or an OS-level ENOENT/permission
message — enough to diagnose without re-running.

Non-exhausted exits (converged/budget-iters/budget-wall/aborted)
do NOT surface lastError — they don't have a transport-error
interpretation.

Proposers without lastError (heuristic adapter) are handled
gracefully via the `proposer.lastError ?? null` coalesce pattern.

6 new tests: 3 at the createLlmProposer level (transport throw +
clear, fresh proposer, parse failure doesn't touch lastError) and 3
at the loop level (exhausted surfaces, non-exhausted doesn't,
missing getter graceful).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CLAUDE.md update + final smoke verification

Document the observability improvements. Run the full smoke check.

**Files:**
- Modify: `CLAUDE.md` (Tuning harness + Test Structure sections)

- [ ] **Step 1: Read CLAUDE.md**

Run: Read `CLAUDE.md` in full. Locate the `## Tuning harness` section (around line 130-170). Note the LLM proposer subsection (added in Phase 2.2b).

- [ ] **Step 2: Add a 2.2c note to the Tuning harness section**

Find the existing bullet about sim-size or N-games (if any — likely not; sim size wasn't a focal point before). If there's no bullet about sim-size in the Tuning harness intro, add one as the first bullet of the section. Otherwise extend the existing bullet. Look for something like:

> - `npm run sim` runs N games per matchup at seed=1 and writes `balance-report.json` (gitignored).

If the number is stated as `200`, update to `1000` and note the history:

> - `npm run sim` runs 1000 games per matchup at seed=1 and writes `balance-report.json` (gitignored). (Default bumped from 200 in Phase 2.2c to reduce standard error below the expected post-tweak signal band.)

If the number isn't explicit in the current text, add a new bullet:

> - Default sim size: 1000 games per matchup (Phase 2.2c; was 200 in Phase 2.1). Reduces standard error on p=0.865 from ~2.4pp to ~1.08pp. Override via `--count=N` on `scripts/simulate.js` or (for the tune loop) by editing `scripts/tune.js`'s `runSim()` constant.

Use whichever matches the existing style — consult the file directly.

- [ ] **Step 3: Extend the LLM proposer subsection for transport-error surfacing**

Find the "LLM proposer" subsection (Phase 2.2b bullet list). Add a new bullet after the bounded-retry bullet:

> - On `exhausted` exit, the loop writes a `## Last transport error` section at the end of `tuning-summary.md` carrying the CLI's error message (timeout, nonzero exit, or ENOENT). Distinguishes rate-limit / quota / CLI-missing cases after the fact (Phase 2.2c).

- [ ] **Step 4: Update the Test Structure table**

Find the `### Test Structure` section. For existing rows:
- `tune-loop` description: append `, worstDistanceCandidate capture, transport-error surfacing` to the list of orchestrator concerns.
- `tune-llmProposer-prompt` description: append `, candidate-distance in history` to the list of shape concerns.
- `tune-llmProposer-propose` description: append `, lastError getter behavior` to the list of glue concerns.

If a row has a period at the end, keep it as a list (no trailing period inside the markdown cell). Match existing style.

- [ ] **Step 5: Run the full test suite once more for the clean-green end state**

Run: `npm test`
Expected: all 331 tests pass (275 base + 49 Phase 2.2b + 7 Phase 2.2c). Note the final count.

- [ ] **Step 6: Run heuristic dry-run smoke**

Run: `npm run tune:dry-run`
Expected: runs 2 iterations, exits `stopped: budget-iters`. Confirms the 1000-game sim + new candidate capture + new summary column don't break the heuristic path. Summary file (if inspected via cat after the run — but the dry-run doesn't write it, so skip this).

Note: dry-run skips the `fs.writeFileSync` calls, so `tuning-summary.md` is NOT written. The smoke only verifies execution doesn't crash.

- [ ] **Step 7 (optional): Run LLM dry-run smoke**

If `claude` CLI is reachable via PATH or `TUNE_CLAUDE_BIN`:

```bash
npm run tune:llm -- --dry-run
```

Expected: 2 iterations with real CLI calls, both emit valid bundles, exits `stopped: budget-iters`. Proves the new `worstDistanceCandidate` prompt field doesn't break the LLM-path wiring. Note the result in the commit message.

If CLI is not reachable: skip this step. Not a blocker for task completion.

- [ ] **Step 8: Commit CLAUDE.md updates**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): note Phase 2.2c observability + sim-size changes

- Default sim size: 1000 games per matchup (was 200).
- LLM proposer bullet added for transport-error surfacing on
  exhausted exits.
- Test Structure rows for tune-loop, tune-llmProposer-prompt,
  tune-llmProposer-propose updated to reflect the new concerns.

End state: <NNN> tests passing. Heuristic tune:dry-run verified
clean. LLM tune:dry-run: <result>.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

Replace `<NNN>` with the exact count from Step 5, and `<result>` with `skipped (CLI unavailable)` or `clean (2 iters, valid bundles)` depending on Step 7's outcome.

- [ ] **Step 9: Verify Phase 2.2c acceptance criteria**

Re-read `ROADMAP.md` § Phase 2.2c acceptance criteria and check each:

1. **Sim default 200 → 1000 + balance-baseline.json regenerated.** → Tasks 1, 2. ✓
2. **worstDistanceCandidate field + summary column.** → Task 3. ✓
3. **LLM prompt includes candidate distance for not-improvement entries.** → Task 4. ✓
4. **Transport error surfaced in summary on exhausted exits.** → Task 5. ✓
5. **Fresh tune:llm produces at least one accepted bundle AND clean exit.** → NOT verified by this plan; requires a human-invoked production run with a working CLI. Plan execution is complete without it.
6. **All existing tests stay green.** → Verified by Step 5. ✓

Criterion 5 is the only one not closed by this plan. It requires a multi-iteration production run with real LLM calls, which is outside the scope of automated plan execution. Document in the final commit message that the 2.2c machinery is complete; AC5 verification is a separate human-invoked activity.

- [ ] **Step 10: Announce readiness**

Phase 2.2c is implementation-complete. Branch is ready for:
- Final branch-level code review (Opus subagent).
- PR against master.
- Optional: production `npm run tune:llm` to verify AC5 (engineer winrate moves below 86.5pp on at least one iteration).

---

## Self-review (inline)

**Spec coverage:**
- AC1 (sim default 200→1000 + baseline regen) → Tasks 1, 2.
- AC2 (worstDistanceCandidate + summary column) → Task 3.
- AC3 (LLM prompt embeds candidate) → Task 4.
- AC4 (transport error surfaced in summary) → Task 5.
- AC5 (production run produces ≥1 accepted bundle) → DEFERRED; human-invoked, not plan-executable.
- AC6 (324+ tests stay green) → Tasks 1, 3, 5 all verify `npm test`. Task 6 final green-state check.

**Placeholder scan:** no TBD/TODO/vague instructions. `<NNN>` and `<result>` in Task 6 Step 8 are literal fill-in slots, not placeholder-pattern defects.

**Type consistency:** `worstDistanceCandidate` used identically in loop.js, llmProposer.js prompt, tune-loop tests, and tune-llmProposer-prompt test. `lastError` getter pattern used identically in llmProposer.js and loop.js. Return-shape extension documented in Design Contracts.

**Scope check:** 6 tasks, roughly 1 commit per task (7 commits counting the baseline regen). Tasks touch 5 source files + 3 test files + 1 config file + 1 data file + 1 docs file. Tight scope, no speculative abstractions.

**Known non-issues:**
- `lastError` is mutable closure state — intentional. Getter pattern prevents external mutation. No new dependency.
- Regression test auto-adopts the new sim size via `baselineMatchup.count`. No test change needed in Task 1; Task 2 happens because the baseline needs regenerating, which then ripples through.
- Task 5's "lastError stays null on parse failure" test codifies a subtle invariant: parse errors are loop-handled as "invalid-output" (with retry), not transport failures. Don't conflate.
