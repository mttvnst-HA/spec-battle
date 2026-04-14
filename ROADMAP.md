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

### Phase 2.2 — LLM-driven proposer

**Goal:** Replace `src/tune/proposer.js` with a Claude Code CLI subprocess proposer that emits *bundled* numeric tweaks informed by the current balance report and recent iteration history. Same loop, smarter proposals — and a two-layer architecture that keeps the interesting logic unit-testable without live LLM calls.

**Depends on:** Phase 2.1 shipping (done, commits through c2917a8). The Phase 2.1 `tuning-summary.md` output is not needed — the ceiling has already been identified from the smoke run (below).

Split into two sub-phases. 2.2a ships first; 2.2b builds on a clean green baseline.

#### Observed Phase 2.1 ceiling (2026-04-13 smoke run, 5 iterations)

The 5-iter smoke accepted **zero** proposals; worst-matchup distance stayed at 36.5pp the whole time. Three concrete gates blocked progress:

- **Test gate rejects value mutations wholesale.** Tests under `src/__tests__/tune-proposer.test.js`, `content-loader.test.js`, and `constants.test.js` hard-code baseline numbers (`dmg: [16,24]`, `GAME.mpRegen: 4`, etc.). Any stat mutation flips one or more of them, so `npm test` returns non-zero and the loop reverts. 4 of 5 iterations hit this path.
- **Improvement gate too strict for a single +1 tweak.** Iter 2 (CLAIM DSC dmg +1) passed tests but did not move the worst-matchup distance enough to satisfy `isImprovement`. Single-step nudges to mid-tier moves just don't shift a 400-game sim by a measurable margin.
- **JSON reformat churn.** `writeProposal` → `writeJson` uses `JSON.stringify(obj, null, 2)`, which expands hand-authored one-line arrays (`[28, 45]`) into multi-line form on every write. Even pure revert cycles leave cosmetic diffs — the numeric state restores correctly, but the file diff is noisy.

Phase 2.2a addresses gates 1 and 3 directly as mechanical prep. Phase 2.2b addresses gate 2 by shipping bundle-shaped proposals — a single LLM-authored bundle can move multiple levers coherently in one iteration.

### Phase 2.2a — Prep (test relaxation + JSON normalization)

**Goal:** Remove the two mechanical blockers so 2.2b starts from a clean green baseline. No LLM work. Mechanical only.

#### Acceptance criteria

1. `tune-proposer.test.js`, `content-loader.test.js`, and `constants.test.js` no longer assert specific baseline numeric values. Assertions test **shape and invariants** (types, bounds, required keys, `[min,max]` ordering, resolved color hex format, quotes array non-empty). Regression against drift remains covered by `balance-regression.test.js` + `balance-baseline.json`.
2. `content/game.json`, `content/moves/engineer.json`, `content/moves/contractor.json` are re-serialized with `JSON.stringify(obj, null, 2)` in a dedicated commit — one-time cosmetic diff, no numeric drift.
3. All 275 tests stay green after both commits. `npm run sim` produces bit-identical `balance-report.json` (no numeric changes leaked through).
4. `npm run tune:dry-run` continues to run cleanly end-to-end.

#### Components to build / modify

- Modify: `src/__tests__/tune-proposer.test.js` — replace value assertions with structural assertions (Proposal shape, target grammar, step-size bounds).
- Modify: `src/__tests__/content-loader.test.js` — replace exact-value checks with invariant checks.
- Modify: `src/__tests__/constants.test.js` — replace `GAME` snapshot with key-presence + type/range assertions.
- Rewrite (format-only): `content/game.json`, `content/moves/engineer.json`, `content/moves/contractor.json`.

#### Out of scope for 2.2a

- Any LLM work
- Any change to `src/tune/*` modules
- Any change to `balance-baseline.json`
- Any change to the heuristic proposer

### Phase 2.2b — LLM proposer

**Goal:** Ship a Claude Code CLI subprocess proposer that emits bundled `ProposalBundle` mutations; wire it into the existing loop behind a selectable proposer flag; keep the heuristic proposer as the default path.

#### Locked decisions

- **Subprocess mechanism:** spawn `claude -p '<prompt>' --output-format json` via `child_process`. No new dependencies. Uses the user's existing Claude Code auth. Default model `claude-sonnet-4-6`.
- **Proposal shape:** `ProposalBundle = { rule, summary, targets: [{target, before, after}, ...] }`. `targets.length ≥ 1` (single-tweak is a legal 1-element bundle — no special-case code path). `applyProposal.write(bundle)` applies in order; `revert(bundle)` applies in reverse order. Any target-resolution failure at write time reverts all prior writes and returns null.
- **Target grammar:** unchanged from Phase 2.1 — `GAME.<key>` or `<side>.<moveName>.<field>` where `field ∈ {dmg, mp}`. Step-size bounds unchanged (±1 int, ±0.02 rate, ±0.05 multiplier, healRange caps per Phase 2.1 rule library).
- **Architecture:** two layers.
  - `src/tune/llmProposer.js` — pure `buildPrompt(state, history)` + `parseBundle(rawResponse, currentState) → {ok, bundle | error}`. Unit-tested with fixture strings.
  - `src/tune/claudeTransport.js` — `createCliTransport({ exec, model, timeoutMs }) → { send(prompt) → string }`. Unit-tested with an injected fake `exec`.
  - Loop injects both: `proposer.propose(report, iteration, history, { transport })`. No real CLI call in any unit test.
- **Prompt shape:** single message, markdown-structured. Static prefix (role, schema, game-rules primer) first for prompt-cache locality; dynamic sections (current `game.json` + `moves/*.json`, current balance report, last 3 iterations with accept/reject reason) follow; closing "Respond with ONLY the JSON — no prose, no code fences" instruction. Target ~4-6k tokens per call.
- **History:** loop keeps an in-memory buffer of `{ bundle, outcome: "accepted" | "tests-failed" | "not-improvement" }` per iteration; passes the last 3 entries into `propose`. Not persisted across loop runs.
- **Invalid output:** one bounded retry — `parseBundle` returns `{ok: false, error}` → loop re-calls `propose` with the error as context → if still invalid, the loop **skips the iteration** (advance counter, no write, no test, no sim, no commit, keep looping). This is a new loop state distinct from `null` — `null` continues to mean "proposer has given up, stop the loop with reason `exhausted`" per the Phase 2.1 contract. The LLM proposer itself only returns `null` if the transport is non-recoverable (e.g. CLI not installed); otherwise it returns `{ok: true, bundle}` or `{ok: false, error}`.
- **Budget:** 30 iterations or 45 minutes wall-clock (whichever hits first). Kill-switch via `.tuning-abort` unchanged.
- **Convergence / acceptance logic:** `isConverged` and `isImprovement` unchanged from 2.1. Bundles work through the existing gates.
- **Proposer selection:** `TUNE_PROPOSER=llm npm run tune` (or `npm run tune:llm`) picks the LLM proposer; default `npm run tune` keeps Phase 2.1 heuristic path for backwards compatibility.

#### Components to build

- Create: `src/tune/llmProposer.js` — `buildPrompt`, `parseBundle`, `propose`.
- Create: `src/tune/claudeTransport.js` — `createCliTransport` + injectable `exec`.
- Modify: `src/tune/applyProposal.js` — single write-path that consumes `ProposalBundle`. `write(bundle)` iterates `bundle.targets`; `revert(bundle)` iterates in reverse. Heuristic proposer output is adapted to 1-element bundles in a small wrapper at the call site (no second `applyProposal` code path, no legacy-Proposal fallback). Phase 2.1 tests that touched the single-target path get updated to use the bundle shape (this is a mechanical change, not a semantic one).
- Modify: `src/tune/loop.js` — accept `history` into `propose` calls; add bounded-retry wrapper for `{ok: false}` returns; change default `maxIterations` to 30 and `maxWallMs` to `45 * 60 * 1000`.
- Modify: `scripts/tune.js` — env-var-selected proposer; optional `--llm` flag sugar.
- Tests: `src/__tests__/tune-llmProposer-parse.test.js` (fixture-based parse cases), `src/__tests__/tune-llmProposer-prompt.test.js` (snapshot-tested prompt assembly), `src/__tests__/tune-claudeTransport.test.js` (fake-exec: success, timeout, nonzero exit), extend `src/__tests__/tune-loop.test.js` with retry-behavior cases.
- Modify: `package.json` — add `tune:llm` script.
- Modify: `CLAUDE.md` — append a short "LLM proposer" subsection under Tuning harness.

#### Dependencies added

None. Claude Code CLI is assumed to be installed and authenticated on the machine where tuning runs.

#### Acceptance criteria

1. `npm run tune:llm` runs end-to-end and exits cleanly on convergence, budget, or abort. Commits accepted bundles. Writes `balance-baseline.next.json` and `tuning-summary.md` on exit.
2. `TUNE_PROPOSER=llm npm run tune:dry-run` runs 2 iterations including real CLI calls, no writes/commits — pre-flight safety check for LLM-path runs.
3. No real CLI call in any unit test. All LLM-path logic covered by fixture-based tests.
4. All existing 275+ tests stay green. Phase 2.1 heuristic `npm run tune` path still works (no regression).
5. A tuning run from clean master terminates with either: (a) engineer win rate in [45%, 55%] for both matchups × 3 consecutive iterations (converged), or (b) `tuning-summary.md` documents a new ceiling — whatever it is — in enough detail to scope follow-up work (a successor sub-phase, Phase 3's BO pass, or prompt/architecture iteration within 2.2).

#### Out of scope for Phase 2.2b

- Cost / token-budget tracking (parked — layer on if/when needed)
- Multi-agent or self-critique proposers (single LLM call per iteration, plus one retry)
- Changes to `isConverged` / `isImprovement` / sim harness
- Changes to `balance-baseline.json` (loop continues to write only `balance-baseline.next.json`)
- Changes to the heuristic proposer

#### Open questions (parked)

- If LLM repeats rejected proposals despite history context, do we need an in-loop dedupe? (Defer until observed; history-in-prompt is the first line of defense.)
- If CLI output shape drifts on a `claude` update, does `parseBundle` need a fallback extractor? (Start with code-fence-stripping + first-JSON-block; iterate on evidence.)
- Should the prompt include prior *accepted* bundles' deltas on `balance-report` to let the LLM learn which levers actually move the sim? (Parked — follow-up iteration once we have run data.)

## Phase 3 — Bayesian optimization sweep (stub)

- **Goal:** Replace or augment the loop's proposer with a BO layer over the most sensitive `GAME` constants, using the balance-delta as the objective.
- **Depends on:** Phase 2 (needs a working loop and a sense of which constants matter most).
- **Biggest parked question:** is BO worth the complexity for a ~10-dim parameter space, or is guided grid search enough?

## Phase 4 — LLM-driven play policy (stub)

- **Goal:** Add an LLM-as-player policy (state serialized → model picks move) as a third matchup, catching strategic imbalances that random/greedy play hides.
- **Depends on:** Phase 1 (needs policy interface) — can run in parallel with Phase 2/3.
- **Biggest parked question:** cost/latency budget — per-iteration in the loop, or periodic audit run?
