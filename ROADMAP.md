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

## Phase 2 — Autonomous tuning loop

**Goal:** A single command runs a Ralph-style loop that proposes tweaks to `GAME` constants and per-move stats, verifies each tweak against tests + sim, commits accepted changes, and stops at convergence / budget / kill-switch. The committed baseline is never touched by the loop; a human reviews the resulting branch and runs `npm run sim:update-baseline` to accept.

Split into two sub-phases. Phase 2.1 ships first; Phase 2.2 is unlocked only if 2.1's heuristic proposer plateaus short of the convergence band.

### Phase 2.1 — Heuristic proposer

**Goal:** Pure-JS rule-library proposer closes the balance gap (current 86.5% / 71.5% engineer) enough to hit the target band, or falsifies itself quickly and informs 2.2.

#### Acceptance criteria

1. `npm run tune` runs the loop end-to-end and exits cleanly on convergence, budget, or abort.
2. `npm run tune:dry-run` runs 2 iterations with no file writes and no git ops — pre-flight safety check.
3. An automated vitest case proves the kill-switch works: drives the loop with a no-op proposer, writes `.tuning-abort` mid-run, asserts graceful stop + summary written.
4. All existing tests stay green. Balance-regression test honors `SKIP_BALANCE_REGRESSION=1` so the loop can run without fighting itself.
5. A tuning run from clean master terminates with either: engineer win rate in **[45%, 55%]** for both matchups for 3 consecutive iterations (converged), or `tuning-summary.md` + committed ROADMAP notes naming the specific rule-library ceiling (informs Phase 2.2). The run may be short if the ceiling is hit on the first iteration — what matters is that the ceiling is documented with enough detail to scope 2.2. (Phase 2.1 finding: the test gate was falsified on iter 1, so 50-iter runs aren't necessary to identify it.)

#### Locked decisions

- **Convergence:** engineer win rate ∈ [45%, 55%] in *both* matchups for 3 consecutive iterations, with no iteration regressing the other matchup by more than 2pp.
- **Budget:** max 50 iterations *or* 15 minutes wall-clock, whichever hits first. No API budget — proposer is local code.
- **Baseline update policy:** loop never writes `balance-baseline.json`. Tracks best-so-far in memory. On exit, writes `balance-baseline.next.json` + `tuning-summary.md` to the branch. Human runs `npm run sim:update-baseline` to accept.
- **Kill-switch:** `.tuning-abort` file (gitignored) primary; SIGINT/SIGTERM secondary; budget caps as hard backstop. Kill-switch has an automated test.
- **Search space:** `GAME` scalars + per-move `damage` / `mp` / effect chances in `content/moves/*.json`. Step sizes clamped (±1 int, ±0.02 rate, ±0.05 multiplier). Refuses out-of-bound values.
- **Per-iteration work:** propose → apply → `npm test` (with regression skipped) → `runBatch` (200 games × 2 matchups, seed=1) → accept-if-better → `git commit` or revert.
- **"Better"** = strictly closer to 50% in the *worst* matchup, with no >2pp regression in the other matchup.

#### Components to build

- `src/tune/proposer.js` — rule library + `propose(report) → Proposal | null`
- `src/tune/applyProposal.js` — serialize/revert a proposal against `constants.js` + `content/moves/*.json`
- `src/tune/convergence.js` — `isConverged(history)`, `isImprovement(prev, curr)`
- `src/tune/loop.js` — main loop (injectable clock/fs/git for testability)
- `src/tune/gitOps.js` — thin wrapper around `git add`/`git commit`
- `scripts/tune.js` — CLI entry (`--max-iters`, `--max-wall`, `--dry-run`)
- Tests for each module + end-to-end kill-switch test
- Modify `src/__tests__/balance-regression.test.js` to honor `SKIP_BALANCE_REGRESSION=1`
- `.gitignore` additions: `.tuning-abort`, `tuning-summary.md`, `balance-baseline.next.json`
- `package.json` scripts: `tune`, `tune:dry-run`

#### Dependencies added

None.

#### Out of scope for Phase 2.1

- LLM-driven proposer (that's 2.2)
- Auto-merging or auto-updating committed baseline
- Tuning move *identity* (names, effects) — only numeric stats
- Changes to sim harness itself

### Phase 2.2 — LLM proposer (stub)

- **Goal:** When Phase 2.1 plateaus short of the convergence band, replace `src/tune/proposer.js` with a Claude Code subprocess call. Same loop, smarter proposals.
- **Depends on:** Phase 2.1 shipping and producing a `tuning-summary.md` that shows the heuristic ceiling.
- **Parked questions:** API budget per run; prompt shape (full `balance-report.json` + move JSON, or targeted slices?); how to keep proposals deterministic enough for a repeatable vitest smoke test.

#### Observed Phase 2.1 ceiling (2026-04-13 smoke run, 5 iterations)

The 5-iter smoke accepted **zero** proposals; worst-matchup distance stayed at 36.5pp the whole time. Three concrete gates blocked progress:

- **Test gate rejects value mutations wholesale.** Tests under `src/__tests__/tune-proposer.test.js`, `content-loader.test.js`, and `constants.test.js` hard-code baseline numbers (`dmg: [16,24]`, `GAME.mpRegen: 4`, etc.). Any stat mutation flips one or more of them, so `npm test` returns non-zero and the loop reverts. 4 of 5 iterations hit this path.
- **Improvement gate too strict for a single +1 tweak.** Iter 2 (CLAIM DSC dmg +1) passed tests but did not move the worst-matchup distance enough to satisfy `isImprovement`. Single-step nudges to mid-tier moves just don't shift a 400-game sim by a measurable margin.
- **JSON reformat churn.** `writeProposal` → `writeJson` uses `JSON.stringify(obj, null, 2)`, which expands hand-authored one-line arrays (`[28, 45]`) into multi-line form on every write. Even pure revert cycles leave cosmetic diffs — the numeric state restores correctly, but the file diff is noisy.

Concrete implications for 2.2 scope:

- An LLM proposer doesn't fix gate 1 on its own — it would need authority to update value-sensitive tests alongside the mutation (or the tests need to stop asserting specific numbers).
- The improvement gate probably wants a slackened first-iteration threshold, or the proposer should emit *bundles* of tweaks rather than single steps.
- Either normalize the source JSON to `JSON.stringify(obj, null, 2)` format (one-time churn, then stable) or give `applyProposal` a formatting-preserving writer.

## Phase 3 — Bayesian optimization sweep (stub)

- **Goal:** Replace or augment the loop's proposer with a BO layer over the most sensitive `GAME` constants, using the balance-delta as the objective.
- **Depends on:** Phase 2 (needs a working loop and a sense of which constants matter most).
- **Biggest parked question:** is BO worth the complexity for a ~10-dim parameter space, or is guided grid search enough?

## Phase 4 — LLM-driven play policy (stub)

- **Goal:** Add an LLM-as-player policy (state serialized → model picks move) as a third matchup, catching strategic imbalances that random/greedy play hides.
- **Depends on:** Phase 1 (needs policy interface) — can run in parallel with Phase 2/3.
- **Biggest parked question:** cost/latency budget — per-iteration in the loop, or periodic audit run?
