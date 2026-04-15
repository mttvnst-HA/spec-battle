# Phase 2.2d — Multi-Seed Averaged Sim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining signal-to-noise gap revealed by the Phase 2.2c AC5 production run. Average `runBatch` across K=3 independent seed chunks in the tuning path so per-iteration win-rate measurements have standard error ~0.91pp instead of ~1.58pp — below the smallest-step signal even when the LLM picks the correct lever by ±1 unit. No proposer-logic changes, no step-size changes, no `isImprovement` changes. Tune uses averaged reports; `balance-baseline.json` + `balance-regression.test.js` stay single-seed.

**Architecture:** New helper `runAveragedBatch` in `src/sim/`, used only by `scripts/tune.js`'s `runSim()`. `runBatch` unchanged. `loop.js` / `convergence.js` / `llmProposer.js` see a normal `BalanceReport` shape — the averaging is invisible downstream.

**Tech Stack:** JavaScript (ES modules), Vite, Vitest. Node ≥22. No new dependencies.

**Why no TDD:** 2.2d adds one pure helper and changes one caller default. The helper has natural unit tests (determinism, averaging math, shape). Iterative code-then-test is faster than TDD for this shape and matches the Phase 2.2c pattern.

---

## File Structure

**Created:**
- `src/sim/runAveragedBatch.js` — pure function: runs K `runBatch` calls with `startSeed + k*count` offsets, averages `engineerWinRate`, `avgTurns`, and per-move `moveFrequency` across the K reports, returns a single BalanceReport (Task 1).
- `src/__tests__/sim-runAveragedBatch.test.js` — unit tests for the helper (Task 1).

**Modified:**
- `scripts/tune.js` — `runSim()` switches from direct `runBatch` calls to `runAveragedBatch` with `K=3`, `count=1000` per chunk (Task 2).
- `CLAUDE.md` — Tuning harness subsection notes that the tune path averages across K=3 seeds; `balance-baseline.json` + the sim CLI (`npm run sim`) remain single-seed (Task 3).

**Not modified:**
- `src/sim/runBatch.js` (unchanged — the averaging helper composes it).
- `src/tune/loop.js` (averaged report has the same shape as a single-seed report; `isImprovement` / `worstDistanceCandidate` / history serialization all keep working).
- `src/tune/convergence.js` (strict-inequality gate stays — the fix is measurement, not the gate).
- `src/tune/llmProposer.js` (`buildPrompt` serializes whatever report shape it's given; no schema change).
- `scripts/simulate.js` (single-seed stays — human-facing baseline contract is easier to reason about unaveraged).
- `balance-baseline.json` (stays single-seed at n=1000, seed=1; `balance-regression.test.js` still uses `baselineMatchup.count` unchanged).
- Budget defaults in `scripts/tune.js` (see Open Questions).

---

## Design Contracts

### `runAveragedBatch(args) → BalanceReport`

```js
/**
 * Run K independent runBatch chunks with disjoint seed ranges, return a
 * single BalanceReport with averaged scalar fields.
 *
 * @param {Object} args
 * @param {number} args.startSeed       - First seed of first chunk.
 * @param {number} args.count           - Games per chunk (each chunk uses startSeed+k*count).
 * @param {number} args.seedChunks      - K; number of independent chunks (>=1).
 * @param {Policy} args.engPolicy
 * @param {Policy} args.conPolicy
 * @param {string} args.engPolicyName
 * @param {string} args.conPolicyName
 * @returns {BalanceReport}
 *
 * Returned report:
 *   - matchup:           same as runBatch (unchanged)
 *   - startSeed:         args.startSeed (the original, not per-chunk)
 *   - count:             args.count * args.seedChunks (aggregate sample size)
 *   - engineerWinRate:   mean across K chunks
 *   - avgTurns:          mean across K chunks
 *   - moveFrequency:     per-side per-move mean across K chunks (keys from the first chunk)
 *
 * With seedChunks=1, behaves exactly like runBatch (no averaging overhead —
 * passthrough). Determinism: same (startSeed, count, K) produces bit-identical
 * output. Uses runBatch's existing seeded xorshift32.
 */
```

**Seed offsetting:** Chunk k uses `startSeed + k * count` so the K chunks never overlap. With `startSeed=1, count=1000, K=3`: seeds [1..1000], [1001..2000], [2001..3000]. No cross-chunk correlation.

**Edge cases:**
- `seedChunks < 1` → throw.
- `seedChunks === 1` → return `runBatch(args)` directly (passthrough, no averaging wrapper cost).
- `moveFrequency` keys: use the first chunk's key set; subsequent chunks with a missing key contribute 0 for that key (moves unused in one seed but used in another average down correctly). This matches `runBatch`'s existing behavior where unused moves are simply absent from the output map.

**Shape contract — why averaging is safe at the report level:**
- `isImprovement` reads `engineerWinRate` only. Averaging three 1000-game Bernoulli samples gives an unbiased estimator with σ/√3 stderr.
- `isConverged` reads `engineerWinRate` in [0.45, 0.55]. Same property.
- `llmProposer.buildPrompt` serializes `engineerWinRate`, `avgTurns`, top-5 `moveFrequency`. All averageable.
- `worstDistanceCandidate` is derived from `engineerWinRate`. Same property.

No field consumed downstream requires raw per-game or per-chunk data.

### `scripts/tune.js` `runSim` wiring

Before:
```js
function runSim() {
  const count = 1000;
  const startSeed = 1;
  const matchups = [
    runBatch({ startSeed, count, engPolicy: randomPolicy, conPolicy: randomPolicy,
               engPolicyName: "random", conPolicyName: "random" }),
    runBatch({ startSeed, count, engPolicy: randomPolicy, conPolicy: aiPolicy,
               engPolicyName: "random", conPolicyName: "ai" }),
  ];
  return { matchups };
}
```

After:
```js
function runSim() {
  const count = 1000;
  const startSeed = 1;
  const seedChunks = 3;
  const matchups = [
    runAveragedBatch({ startSeed, count, seedChunks,
                       engPolicy: randomPolicy, conPolicy: randomPolicy,
                       engPolicyName: "random", conPolicyName: "random" }),
    runAveragedBatch({ startSeed, count, seedChunks,
                       engPolicy: randomPolicy, conPolicy: aiPolicy,
                       engPolicyName: "random", conPolicyName: "ai" }),
  ];
  return { matchups };
}
```

Two-line change plus the import swap. The `count` constant now means "games per chunk" rather than "total games"; aggregate per-matchup is 3000.

### Determinism

`runAveragedBatch(startSeed=1, count=1000, K=3)` must produce bit-identical output on repeat calls. Achieved by:
- Deterministic seed offsets (no Math.random() anywhere).
- Averaging is deterministic (fixed-order floating-point sum / K).
- `runBatch` itself is already deterministic (xorshift32).

Unit test asserts determinism directly.

---

## Task 1: `runAveragedBatch` helper + tests

**Files:**
- Create: `src/sim/runAveragedBatch.js`
- Create: `src/__tests__/sim-runAveragedBatch.test.js`

- [ ] **Step 1: Skim `src/sim/runBatch.js`** to confirm the BalanceReport shape this helper must emit. Capture the field list so the helper's averaging covers everything `loop.js` and `llmProposer.js` read downstream.

- [ ] **Step 2: Implement `runAveragedBatch`**

  Pure function per the Design Contract above. Imports `runBatch`. Handles `seedChunks === 1` as a passthrough (no wrapper objects, no averaging overhead). For `seedChunks > 1`: runs K chunks, computes per-field means, returns a synthesized BalanceReport. Uses `Object.keys` + `reduce` for the `moveFrequency` average (union of keys across chunks, mean where absent counts as 0).

- [ ] **Step 3: Write tests**

  Cases for `src/__tests__/sim-runAveragedBatch.test.js`:
  - `seedChunks=1` passthrough: output equals `runBatch(args)` byte-identical.
  - `seedChunks=3` determinism: two calls with same args produce identical output.
  - `seedChunks=3` averaging: `engineerWinRate` and `avgTurns` equal the mean of three individual `runBatch` calls at the same seed offsets.
  - `seedChunks=3` `moveFrequency`: per-move values are the mean across chunks; a move used in 2 of 3 chunks averages to `(f1 + f2 + 0) / 3`.
  - `seedChunks=3` aggregate `count`: returns `count * seedChunks`.
  - `seedChunks < 1`: throws.

  Use tiny `count` (e.g., 10) in tests for speed. Use `randomPolicy` vs `randomPolicy` matchup.

- [ ] **Step 4: Run tests**

  Run: `npm test -- sim-runAveragedBatch`
  Expected: all new tests green. Existing 453 tests unaffected.

- [ ] **Step 5: Commit**

  ```
  feat(sim): add runAveragedBatch helper for multi-seed reports

  Phase 2.2d Task 1. Pure helper that composes K independent runBatch
  chunks (seeds disjoint at startSeed + k*count) and returns a single
  averaged BalanceReport. engineerWinRate / avgTurns / moveFrequency
  averaged; count = chunk count * K. seedChunks=1 is passthrough.

  Used only by the tuning path (Task 2). scripts/simulate.js and
  balance-baseline.json remain single-seed — the averaging tightens
  the signal the LLM proposer sees, not the human-facing contract.

  Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
  ```

## Task 2: Wire `runAveragedBatch` into `scripts/tune.js`

**Files:**
- Modify: `scripts/tune.js`

- [ ] **Step 1: Add import** alongside existing `runBatch` import:

  ```js
  import { runAveragedBatch } from "../src/sim/runAveragedBatch.js";
  ```

  (Keep the `runBatch` import — it's not used by `runSim` anymore, but leaving it avoids churn if a future phase reintroduces a direct call. Actually — prefer to remove it if `runSim` is the only caller; grep first.)

  Grep: `grep -n "runBatch" scripts/tune.js` — confirm `runSim` is the only caller. If so, remove the `runBatch` import and add only `runAveragedBatch`.

- [ ] **Step 2: Update `runSim`** per the Design Contract "After" snippet. `count = 1000`, `seedChunks = 3`.

- [ ] **Step 3: Heuristic dry-run smoke**

  Run: `npm run tune:dry-run`
  Expected: runs 2 iterations, exits `stopped: budget-iters`. Per-iter time is ~3× longer than before (3 chunks of 1000 games × 2 matchups per iter). Should still complete in well under a minute.

- [ ] **Step 4: Full test suite**

  Run: `npm test`
  Expected: all 453+ tests stay green. `balance-regression.test.js` is unaffected — it uses `runBatch` directly with `baselineMatchup.count`, no averaging.

- [ ] **Step 5: Commit**

  ```
  feat(tune): average sim across K=3 seeds for tighter improvement gate

  Phase 2.2d Task 2. runSim() now calls runAveragedBatch(K=3) instead
  of single-seed runBatch. Standard error on per-matchup winrate drops
  from ~1.58pp (n=1000) to ~0.91pp (3×1000 averaged) — below the
  smallest-step signal so the LLM can actually prove it moved the
  needle within isImprovement's strict gate.

  Aggregate per-iter sim cost is 3× (6000 games vs 2000) but wall
  clock impact is modest — the 2.2c production runs showed CLI
  calls, not sims, dominate per-iter time. Budget stays at 30 iters /
  45 min; revisit if budget-wall becomes the binding constraint.

  balance-baseline.json and `npm run sim` stay single-seed — those
  are the human-readable contract, averaging only applies inside the
  tune loop.

  Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
  ```

## Task 3: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Tuning harness subsection**

  Add a bullet near the existing "sim noise floor" note:

  > - Phase 2.2d: the tune path runs sim averaged across K=3 seeds (3000 games per matchup per iteration) via `runAveragedBatch`. Standard error on per-matchup winrate is ~0.91pp — tight enough that a correctly-directed ±1 step is statistically detectable. `balance-baseline.json` and `npm run sim` remain single-seed; averaging is tune-only.

- [ ] **Step 2: Commit**

  ```
  docs(claude-md): document Phase 2.2d multi-seed tune averaging

  Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
  ```

## Task 4: AC verification — fresh LLM tune run

- [ ] **Step 1: Clean working tree + env vars**

  Working tree clean on master. Env vars set:
  - `TUNE_CLAUDE_BIN=<absolute path to claude.exe>`
  - `CLAUDE_CODE_GIT_BASH_PATH=<absolute path to bash.exe>` (Windows only)

- [ ] **Step 2: LLM dry-run smoke**

  Run: `TUNE_PROPOSER=llm npm run tune:dry-run`
  Expected: 2 iterations, real CLI calls, clean exit. Confirms wiring is intact end-to-end with multi-seed averaging.

- [ ] **Step 3: Production LLM tune run**

  Run: `npm run tune:llm`
  Expected: runs up to 30 iterations / 45 min. At least one iteration produces `outcome: accepted` AND exits cleanly (`converged`, `budget-iters`, or `budget-wall` — not `exhausted`). If `exhausted` recurs, capture the transport error and file a separate followup (independent of multi-seed; the ETIMEDOUT thread is orthogonal to this phase).

- [ ] **Step 4: Interpret `tuning-summary.md`**

  Inspect the accepted/rejected distribution. Goal: `worstDistanceCandidate` values should span a wider range than the flat 38.40 seen across 2.2c runs — if candidates are legitimately clustering below baseline, the noise-reduction thesis holds. Write a brief summary (can live in the PR description, doesn't need a doc commit).

## Task 5: Ship PR

- [ ] Open PR with Tasks 1–3 commits. Include the Task 4 AC summary in the PR description. Do NOT include `balance-baseline.next.json` or `tuning-summary.md` (both gitignored; regenerated per run).

---

## Acceptance Criteria

1. `runAveragedBatch` exists at `src/sim/runAveragedBatch.js`, unit-tested, deterministic, passthrough at K=1.
2. `scripts/tune.js` `runSim()` uses `runAveragedBatch` with K=3. `balance-baseline.json` unchanged. `scripts/simulate.js` unchanged. `balance-regression.test.js` stays green.
3. All 453+ existing tests stay green; 6+ new tests added for `runAveragedBatch`.
4. `npm run tune:dry-run` continues to run end-to-end cleanly.
5. A fresh `npm run tune:llm` from clean master produces ≥1 accepted bundle AND exits cleanly (not `exhausted`) — OR, if `exhausted` recurs despite multi-seed averaging, `tuning-summary.md` shows `worstDistanceCandidate` values diverging from a flat pattern (evidence that the noise floor is no longer the binding constraint), and the ETIMEDOUT is scoped as a follow-up phase.
6. CLAUDE.md Tuning harness subsection documents the K=3 averaging.

## Open Questions (parked)

- **Budget wall-clock:** current 45 min may become tight when CLI calls are fast and sim time dominates. Kept at 45 min for now; raise to 60 min if the first 2.2d run hits `budget-wall` before `budget-iters`.
- **K=3 vs K=5:** K=3 drops stderr by √3 ≈ 1.73×; K=5 by √5 ≈ 2.24×. K=3 is the right first try — cheap, clear benefit. If K=3 still leaves `worstDistanceCandidate` pinned, K=5 is the next step (parked).
- **ETIMEDOUT mitigation:** both 2.2c AC5 runs died on `spawnSync claude.exe ETIMEDOUT`. Orthogonal to noise reduction — worth a separate sub-phase (bump `TUNE_TIMEOUT_MS` default + add one transport-level retry). Parked here; address in Phase 2.2e if 2.2d also hits it.
- **Averaged baseline:** the natural followup if 2.2d works is to regenerate `balance-baseline.json` as an averaged K=3 report so `balance-regression.test.js`'s contract matches the tune loop's measurement floor. Parked — decide after seeing 2.2d behavior.

## Out of Scope

- `isImprovement` changes (strict-inequality stays — measurement fix, not gate fix).
- Step-size widening (stays at ±1 dmg, ±0.02 rate, ±0.05 multiplier).
- Transport-layer retry / timeout bumps (parked for 2.2e if needed).
- Baseline regeneration at averaged K=3 (parked).
- Changes to the heuristic proposer or its tests.
- Changes to the content pipeline or dialog system.
