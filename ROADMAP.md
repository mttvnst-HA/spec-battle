# Autonomous Development Roadmap

**Created:** 2026-04-13
**Branch:** `iterative-development`

## End Goal

Claude Code can run an autonomous development loop on spec-battle that — starting from any clean committed state — produces measurable, test-verified improvements to game **balance** (closer to a target win-rate band and more uniform move usage than the committed baseline), commits them to a branch, and stops when a budget or convergence criterion is met. No human intervention during the run; human review of the resulting branch at the end.

### What "done" looks like

1. A single command (e.g. `npm run autonomous` or a `/loop` invocation) runs end-to-end: proposes changes → runs tests + sim → commits on pass → iterates until converged or budget hit.
2. `npm run sim` produces a deterministic `balance-report.json` from N seeded games.
3. `npm test` includes balance-regression tests (baseline-delta based) that fail fast on drift.
4. All 208 existing tests stay green throughout. Kill-switch tested before any unattended run.
5. After a run, a human can read the branch diff + final report and decide to merge, revise, or discard.

### Out of scope for the whole roadmap

- Auto-merging to master — humans always review.
- Shipping new mechanics as part of the autonomous loop.
- Making the agent "smarter than greedy" beyond what Phase 4 explicitly adds.
- Content expansion (new quotes, intros, game-over lines). This is a different problem — LLM-generative, not numerically optimizable — and deserves its own roadmap if pursued.

## Locked decisions (apply across phases)

- **No new dependencies.** Tiny inline xorshift32 for seeded RNG, not the `seedrandom` package.
- **`src/sim/` module + thin `scripts/simulate.js` CLI wrapper.** Harness is reusable by tests, not shelled out.
- **`balance-report.json` is gitignored; `balance-baseline.json` is tracked.** Reports are artifacts, baselines are contracts.
- **RNG injection via seedable module.** `src/game/rng.js` exports `seed`, `random`, `rand`, `pick`. No signature changes in game logic.

## Phase 1 — Foundation

**Goal:** Deterministic, seeded simulation of spec-battle with a recorded balance baseline and regression tests that fail on drift.

### Acceptance criteria

1. `npm run sim` produces a deterministic `balance-report.json` — same seed, same numbers, every run.
2. `balance-baseline.json` is committed and updatable via `npm run sim:update-baseline`.
3. `npm test` includes balance regression tests that compare current-run stats to baseline (engineer win rate ±3pp, per-move frequency ±5pp, per matchup).
4. All 208 existing tests still pass.
5. Two matchups covered: Random-vs-Random and Random-vs-`pickAIMove`.

### Components to build

- `src/game/rng.js` — seedable xorshift32 module exporting `seed(n)`, `random()`, `rand(a,b)`, `pick(arr)`. Replaces inline `Math.random()` in `logic.js` and the `rand`/`pick` helpers in `constants.js`.
- `src/sim/policies.js` — `randomPolicy(state, side)` and `aiPolicy(state, side)` (wraps existing `pickAIMove`).
- `src/sim/runGame.js` — runs one full game end-to-end by driving the reducer with two policies and a seed; returns game stats.
- `src/sim/runBatch.js` — runs N games with incremented seeds; aggregates into a `BalanceReport`.
- `scripts/simulate.js` — CLI wrapper: flags for matchup, N, seed, output path.
- `src/__tests__/balance-regression.test.js` — loads baseline, runs small batch, diffs.
- `balance-baseline.json` at repo root — committed.
- `package.json` scripts: `sim`, `sim:update-baseline`.
- `.gitignore` addition for `balance-report.json`.

### Dependencies

None added.

### Open questions (parked until data exists)

- How many games per CI run? Start at 200; revisit if flaky or too slow.
- Should the baseline track p50 turn count too, or just win rate + move freq? Start with win rate + move freq; add if needed.
- Does move-usage entropy get its own floor threshold, or is per-move frequency band enough? Per-move band for now — entropy is derivable from it later.

### Out of scope for Phase 1

- Any autonomous loop or tuning
- New game mechanics
- LLM-as-player
- CI integration beyond what `npm test` already does

## Phase 2 — Autonomous tuning loop (stub)

- **Goal:** Claude Code runs a Ralph-style loop that proposes changes to `GAME` constants and per-move stats, verifies against tests + baseline, commits passing changes, and stops at convergence or budget.
- **Depends on:** Phase 1 (needs `npm run sim` + regression tests).
- **Biggest parked question:** what counts as "converged"? Win-rate delta within tolerance for N consecutive iterations? Budget exhaustion? Both?

## Phase 3 — Bayesian optimization sweep (stub)

- **Goal:** Replace or augment the loop's proposer with a BO layer over the most sensitive `GAME` constants, using the balance-delta as the objective.
- **Depends on:** Phase 2 (needs a working loop and a sense of which constants matter most).
- **Biggest parked question:** is BO worth the complexity for a ~10-dim parameter space, or is guided grid search enough?

## Phase 4 — LLM-driven play policy (stub)

- **Goal:** Add an LLM-as-player policy (state serialized → model picks move) as a third matchup, catching strategic imbalances that random/greedy play hides.
- **Depends on:** Phase 1 (needs policy interface) — can run in parallel with Phase 2/3.
- **Biggest parked question:** cost/latency budget — per-iteration in the loop, or periodic audit run?
