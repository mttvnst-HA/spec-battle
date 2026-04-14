# Phase 2.2b — LLM Proposer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/tune/proposer.js` as the loop's default proposer (behind `TUNE_PROPOSER=llm`) with a Claude Code CLI subprocess proposer that emits **bundled** numeric tweaks informed by the current balance report and recent iteration history. Keep the Phase 2.1 heuristic path working unchanged as the default.

**Architecture:** Two pure-logic modules + one transport module under `src/tune/`. `llmProposer.js` owns prompt assembly (`buildPrompt`) and response validation (`parseBundle`) — fixture-tested, zero I/O. `claudeTransport.js` owns the `claude -p ... --output-format json` subprocess — injected-`exec`-tested. `applyProposal.js` is extended to a single bundle-shaped write/revert path; the heuristic proposer's single-Proposal output gets wrapped into a 1-element bundle at the composition root (`scripts/tune.js`). Loop adds bounded 1-retry on `{ok: false}` + records richer history entries including worst-matchup distance deltas for accepted bundles.

**Tech Stack:** JavaScript (ES modules), Vite, Vitest. Node ≥22 (JSON import attributes, top-level await). No new dependencies — transport uses `child_process.execFileSync`. Claude Code CLI is assumed installed and authenticated on the host.

---

## File Structure

**New files:**
- `src/tune/llmProposer.js` — `buildPrompt(args) → string`, `parseBundle(rawCliOutput, currentState) → {ok, bundle|error}`, `createLlmProposer({ transport }) → { propose(report, iteration, history, opts?) }`.
- `src/tune/claudeTransport.js` — `createCliTransport({ exec, model, timeoutMs }) → { send(prompt) → string }`. Default `exec` wraps `child_process.execFileSync`.
- `src/__tests__/tune-llmProposer-parse.test.js` — fixture-based parseBundle tests.
- `src/__tests__/tune-llmProposer-prompt.test.js` — snapshot/assertion-based buildPrompt tests.
- `src/__tests__/tune-llmProposer-propose.test.js` — createLlmProposer glue tests with a fake transport.
- `src/__tests__/tune-claudeTransport.test.js` — fake-exec tests (success, nonzero exit, timeout).

**Modified files:**
- `src/tune/applyProposal.js` — rename `writeProposal` → `writeBundle`, `revertProposal` → `revertBundle`. Iterate `bundle.targets` (write in order, revert in reverse). On mid-write failure, revert any prior writes and rethrow.
- `src/__tests__/tune-applyProposal.test.js` — update call sites to bundle shape; add N-element write+revert case and mid-write-failure rollback case.
- `src/tune/loop.js` — bounded 1-retry on `{ok: false}` results; record new outcome types (`"invalid-output"`, `"write-failed"`); capture `worstDistanceBefore` / `worstDistanceAfter` into history entries; change default `maxIterations` to 30, `maxWallMs` to 45 × 60 × 1000.
- `src/__tests__/tune-loop.test.js` — update to match new history-entry shape; add retry, invalid-output, write-failed, and delta-capture cases. Update tests that assumed the 50/15min default.
- `scripts/tune.js` — env-var-selected proposer (`TUNE_PROPOSER=llm` → LLM proposer, otherwise heuristic); add `createHeuristicAdapter` bundle wrapper; optionally accept a `--llm` flag as sugar for the env var.
- `package.json` — add `tune:llm` script.
- `CLAUDE.md` — extend the "Tuning harness" section with an "LLM proposer" subsection.

**Not modified:**
- `src/tune/proposer.js` — heuristic rule library unchanged.
- `src/tune/convergence.js` — `isConverged`, `isImprovement` unchanged (bundles pass through gates unchanged).
- `src/tune/gitOps.js` — commit-wrapper unchanged.
- `src/sim/*` — simulation harness unchanged.
- `balance-baseline.json` — regression contract, never touched.
- `vitest.config.js` — `fileParallelism: false` stays (see CLAUDE.md rationale).

---

## Design Contracts

Read these before starting any task. Tasks reference them by name.

### Bundle shape

```js
/**
 * @typedef {Object} BundleTarget
 * @property {string} target  - "GAME.<key>" | "<side>.<moveName>.<dmg|mp>"
 * @property {*}      before  - current value (scalar or [min,max]). MUST match current file state.
 * @property {*}      after   - proposed value (same shape as before). MUST pass step-size bounds.
 *
 * @typedef {Object} ProposalBundle
 * @property {string}         rule     - short label, e.g. "llm-buff-contractor-crit-path"
 * @property {string}         summary  - ≤80-char one-liner used in commit message
 * @property {BundleTarget[]} targets  - length ≥ 1. Single-tweak is a 1-element bundle.
 */
```

Target grammar is unchanged from Phase 2.1 (see `plans/2026-04-13-phase-2-1-heuristic-tuning-loop.md` § Design Contracts → Proposal shape): `GAME.<key>` or `<side>.<moveName>.<field>` where `field ∈ {dmg, mp}` and `side ∈ {engineer, contractor}`.

Step-size bounds (unchanged from Phase 2.1): ±1 int for `dmg`/`mp`, ±0.02 for rates, ±0.05 for multipliers, `healRange` caps per the rule library. A bundle is rejected by `parseBundle` if any target's `after` violates these bounds.

### History entry shape

```js
/**
 * @typedef {Object} HistoryEntry
 * @property {number}          iteration             - 1-based iteration number
 * @property {ProposalBundle|null} bundle            - null only for the synthetic baseline entry at iteration 0
 * @property {"accepted"|"not-improvement"|"tests-failed"|"invalid-output"|"write-failed"|"baseline"} outcome
 * @property {Object}          report                - BalanceReport bundle active AFTER this iteration
 * @property {number|undefined} worstDistanceBefore  - worst-matchup distance BEFORE this iteration's sim (undefined if sim didn't run)
 * @property {number|undefined} worstDistanceAfter   - worst-matchup distance AFTER this iteration's sim (present only when outcome === "accepted")
 */
```

- The loop owns this history. It appends one entry per iteration.
- `buildPrompt` receives the last 3 entries (excluding the synthetic baseline-outcome entry if it's in the last 3). Each entry in the prompt includes bundle, outcome, and — for `accepted` entries — both distance numbers as the Q3 delta signal.
- `worst(report)` = `Math.max(...report.matchups.map(m => Math.abs(m.engineerWinRate - 0.5)))`.

### Proposer contract (unified)

```js
/**
 * @typedef {Object} ProposeOk     - { ok: true, bundle: ProposalBundle }
 * @typedef {Object} ProposeFail   - { ok: false, error: string }
 * @typedef {ProposeOk | ProposeFail | null} ProposeResult
 */

// propose(report, iteration, history, opts?) → ProposeResult
// - iteration: 0-based, matching Phase 2.1 convention (loop passes iter-1).
// - history: array of HistoryEntry, oldest first. Proposer may use last N.
// - opts.retryError: string present on the second call of the bounded retry; absent otherwise.
// - Return null → loop stops "exhausted" (non-recoverable, e.g. CLI binary missing).
// - Return {ok:false} → loop triggers ONE retry; if still {ok:false}, records "invalid-output" and advances.
```

The heuristic proposer's output (`Proposal | null`) is adapted in `scripts/tune.js` → `createHeuristicAdapter`: `null` stays `null`; a Proposal becomes `{ ok: true, bundle: { rule, summary, targets: [{ target, before, after }] } }`. The heuristic adapter ignores `history` and `opts`.

### Parse ladder

`parseBundle(rawCliOutput, currentState) → { ok, bundle | error }` applies these steps in order; first success wins:

1. **Envelope parse.** `JSON.parse(rawCliOutput)` → expect `{type, subtype, result, ...}` (the shape of `claude -p --output-format json`). Extract `.result` as `inner` (string). If the envelope isn't JSON, treat `rawCliOutput` itself as `inner` (some exec paths may already return just the text).
2. **Direct inner parse.** `JSON.parse(inner)` → if object, go to step 5.
3. **Fence strip.** If `inner` matches `` /```(?:json)?\n([\s\S]*?)\n``` / ``, take the captured group and `JSON.parse` it.
4. **First-brace extract.** Find the first `{` in `inner`, walk forward tracking balanced `{` / `}` (respecting string literals), slice to the matching `}`, `JSON.parse` the slice.
5. **Schema validate.** The parsed object must have: `rule` (non-empty string), `summary` (non-empty string ≤200 chars), `targets` (non-empty array). Each target: `target` (string matching `/^(GAME\.[a-zA-Z]+|(?:engineer|contractor)\.[^.]+\.(?:dmg|mp))$/`), `before` (scalar or 2-int array), `after` (same shape as `before`), `before` must equal currentState at that target path (deep equality for arrays), `after` must satisfy step-size bounds for that target's field.

Any step failing returns `{ ok: false, error: "<human-readable reason>" }`. Steps 1–4 failures are parse errors; step 5 failures are validation errors. Error strings should be specific enough that the bounded retry gives the LLM actionable feedback (e.g. `"targets[1].before was [16,24] but content/moves/engineer.json has [17,25]"`).

### Loop retry shape

Per-iteration pseudocode (replaces `loop.js` lines 55–89):

```
for iter = 1...:
  if abort file → finalize "aborted"
  if wall-clock exceeded → finalize "budget-wall"
  if iter > iterLimit → finalize "budget-iters"
  if isConverged(history.reports) → finalize "converged"

  let result = proposer.propose(current, iter - 1, history)
  if result === null → finalize "exhausted"
  if !result.ok:
    result = proposer.propose(current, iter - 1, history, { retryError: result.error })
    if !result.ok:
      pushHistory({ iteration: iter, bundle: null, outcome: "invalid-output",
                    report: current, worstDistanceBefore: worst(current) })
      continue
  const bundle = result.bundle

  try:
    if !dryRun: apply.write(bundle)
  catch:
    // write is transactional: any mid-write failure reverts prior writes before throwing.
    pushHistory({ iteration: iter, bundle, outcome: "write-failed",
                  report: current, worstDistanceBefore: worst(current) })
    continue

  const tests = runTests()
  if !tests.ok:
    if !dryRun: apply.revert(bundle)
    pushHistory({ iteration: iter, bundle, outcome: "tests-failed",
                  report: current, worstDistanceBefore: worst(current) })
    continue

  const candidate = runSim()
  if isImprovement(current, candidate):
    if !dryRun: git.commitAll(`tune(iter-${iter}): ${bundle.summary}`)
    pushHistory({ iteration: iter, bundle, outcome: "accepted", report: candidate,
                  worstDistanceBefore: worst(current), worstDistanceAfter: worst(candidate) })
    current = candidate
  else:
    if !dryRun: apply.revert(bundle)
    pushHistory({ iteration: iter, bundle, outcome: "not-improvement",
                  report: current, worstDistanceBefore: worst(current) })
```

The baseline iteration (pre-loop) pushes `{ iteration: 0, bundle: null, outcome: "baseline", report: baseline }` with no distance fields. Existing `summarizeHistory` is refactored to the new entry shape in Task 7.

### Budget defaults

`runLoop`'s default `maxIterations` changes from 50 to 30; `maxWallMs` from `15 * 60 * 1000` to `45 * 60 * 1000`. Tests that rely on defaults must update; tests that pass explicit budgets are unaffected.

### Proposer-selection wiring

`scripts/tune.js` reads `process.env.TUNE_PROPOSER` (default `"heuristic"`). Valid values: `"heuristic"`, `"llm"`. Anything else → error and exit non-zero.

```js
const kind = process.env.TUNE_PROPOSER ?? "heuristic";
const proposer = kind === "llm"
  ? createLlmProposer({
      transport: createCliTransport({
        model: process.env.TUNE_MODEL ?? "claude-sonnet-4-6",
        timeoutMs: Number(process.env.TUNE_TIMEOUT_MS ?? 120_000),
      }),
    })
  : createHeuristicAdapter(propose);  // wraps heuristic propose → bundle API
```

`TUNE_MODEL` and `TUNE_TIMEOUT_MS` are escape-hatch env vars for tuning runs (not documented beyond code comments). Hard rules: no secrets in env; CLI auth comes from the host's existing `claude` login.

---

## Task 1: Bootstrap — `tune:llm` script, budget defaults, update default-budget tests

Add the npm script and change `runLoop` default budgets. Update the two pre-existing tests that relied on 50/15min defaults. This is the smallest task; ships unblocking plumbing first.

**Files:**
- Modify: `package.json` (add one script line)
- Modify: `src/tune/loop.js` (two default-value changes)
- Modify: `src/__tests__/tune-loop.test.js` (update any test that assumed the old defaults)

- [ ] **Step 1: Read current tune-loop tests to find default-budget assumptions**

Run: Read `src/__tests__/tune-loop.test.js`.

Grep for `maxIterations` and `maxWallMs` usage. If any test omits them and relies on the default, note the line number — it needs explicit overrides to keep its intent when the default changes. If every test passes explicit values, Step 3 below is a no-op for tests.

- [ ] **Step 2: Change default budgets in `src/tune/loop.js`**

Locate lines 26–28 of `src/tune/loop.js`:

```js
  maxIterations = 50,
  maxWallMs = 15 * 60 * 1000,
```

Replace with:

```js
  maxIterations = 30,
  maxWallMs = 45 * 60 * 1000,
```

- [ ] **Step 3: Update tune-loop tests that assumed the old defaults**

For every test identified in Step 1 that depended on `50` or `15 * 60 * 1000`, either:
- Add an explicit `maxIterations: 50` or `maxWallMs: 15 * 60 * 1000` override (preserves the test's intent — it was testing *something specific*, not "whatever the default is"), or
- Update the assertion if the test was genuinely checking the default (rare — most tests pass explicit budgets for speed).

If no tests were affected, this step is a no-op — annotate the step with "no changes".

- [ ] **Step 4: Add `tune:llm` script to `package.json`**

In `package.json`, add a line after the existing `"tune:dry-run"` script:

```json
    "tune": "node scripts/tune.js",
    "tune:dry-run": "node scripts/tune.js --dry-run",
    "tune:llm": "cross-env TUNE_PROPOSER=llm node scripts/tune.js"
```

**Wait — no new deps rule.** `cross-env` would be a new dep. Use a bash-native env assignment instead:

```json
    "tune:llm": "TUNE_PROPOSER=llm node scripts/tune.js"
```

This works under Git Bash on Windows (the project's shell per CLAUDE.md) and under POSIX shells. It does NOT work under cmd.exe — documented in Task 9 CLAUDE.md update. Acceptable because the tuning harness is already a bash-targeted tool (see `scripts/tune.js` and existing `test` script usage).

- [ ] **Step 5: Run tests to verify no regression**

Run: `npm test`
Expected: all 275 tests pass (or whatever count the pre-change state was — note the count for reference going forward). If any test fails because of the budget default change, return to Step 3 and add the missing override.

- [ ] **Step 6: Smoke-check that the heuristic path still runs**

Run: `npm run tune:dry-run`
Expected: runs 2 iterations, exits cleanly, no file writes. Confirms nothing broke.

- [ ] **Step 7: Commit**

```bash
git add package.json src/tune/loop.js src/__tests__/tune-loop.test.js
git commit -m "feat(tune): add tune:llm script and update loop defaults to 30/45min

Phase 2.2b plumbing. New npm script tune:llm sets TUNE_PROPOSER=llm
and invokes the same CLI. Loop default budgets change from 50/15min
(Phase 2.1) to 30/45min (Phase 2.2b per ROADMAP § Phase 2.2b Locked
decisions — LLM path is slower per iteration, fewer iters needed for
bundle-shaped proposals).

Tests that relied on the prior defaults pass explicit overrides so
they continue testing what they intended.

Env-var selection (TUNE_PROPOSER=heuristic|llm) is a no-op until
scripts/tune.js is wired in Task 8 — for now this script just runs
the default heuristic path with the env var set."
```

---

## Task 2: `applyProposal.js` → bundle shape + N-element tests

Refactor the single-Proposal path to a single Bundle path. The function rename (`writeProposal` → `writeBundle`, `revertProposal` → `revertBundle`) makes the new shape obvious at call sites; the loop call in Task 7 uses `apply.write`/`apply.revert` aliases regardless.

Mid-write failure transactionality: if `writeBundle` is halfway through a 3-target bundle and target 2 throws (e.g. unknown move name), the already-written target 1 must be reverted before re-throwing. This is *critical* — without it, a partial bundle corrupts content/*.json.

**Files:**
- Modify: `src/tune/applyProposal.js`
- Modify: `src/__tests__/tune-applyProposal.test.js`

- [ ] **Step 1: Read current test file to inventory call sites**

Run: Read `src/__tests__/tune-applyProposal.test.js`.

Every test will need its `writeProposal(p)` / `revertProposal(p)` calls updated to bundle shape. Note the count for Step 4's commit message.

- [ ] **Step 2: Rewrite `src/tune/applyProposal.js`**

Replace `writeProposal` and `revertProposal` (lines 81–87 of current file) with:

```js
export function writeBundle(bundle) {
  const written = [];
  try {
    for (const t of bundle.targets) {
      applyValue({ target: t.target, after: t.after }, t.after);
      written.push(t);
    }
  } catch (err) {
    // Transactional: revert anything written before the failure, in reverse order.
    for (let i = written.length - 1; i >= 0; i--) {
      const t = written[i];
      try {
        applyValue({ target: t.target, before: t.before }, t.before);
      } catch {
        // Revert-during-failure should not mask the original error. Log to stderr for visibility.
        // eslint-disable-next-line no-console
        console.error(`writeBundle: failed to revert ${t.target} during rollback`);
      }
    }
    throw err;
  }
}

export function revertBundle(bundle) {
  // Apply reverts in reverse order so later writes are undone before earlier ones.
  for (let i = bundle.targets.length - 1; i >= 0; i--) {
    const t = bundle.targets[i];
    applyValue({ target: t.target, before: t.before }, t.before);
  }
}
```

Note `applyValue` already accepts a `{target, ...}` shape — we just pass a minimal synthetic proposal with only the fields it reads (`target`, plus `before` or `after` depending on which value we're writing). `applyValue` itself is unchanged.

Keep `readConfig`, `writeJson`, `readJson`, `parseTarget`, and `applyValue` (the internal helpers) exactly as they are — they're shared infrastructure.

Also keep module-level exports of `readConfig` (the proposer imports it).

**Do not** keep backwards-compatible aliases like `export const writeProposal = writeBundle`. Per ROADMAP: "Heuristic proposer output is adapted to 1-element bundles in a small wrapper at the call site (no second `applyProposal` code path, no legacy-Proposal fallback)." The call sites are `scripts/tune.js` (updated in Task 8) and `src/__tests__/tune-applyProposal.test.js` (updated in Step 3 below); both move to the new names.

- [ ] **Step 3: Update `src/__tests__/tune-applyProposal.test.js` call sites**

For every `writeProposal(p)` call in the test file, convert `p` to a 1-element bundle:

```js
// OLD:
writeProposal({ rule: "x", target: "GAME.critRate", before: 0.12, after: 0.14, summary: "s" });

// NEW:
writeBundle({
  rule: "x",
  summary: "s",
  targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }],
});
```

Same pattern for `revertProposal` → `revertBundle`. Update the import line at the top of the file from `import { writeProposal, revertProposal } from "../tune/applyProposal.js"` to `import { writeBundle, revertBundle } from "../tune/applyProposal.js"`. Leave the `readConfig` import alone if it's present.

- [ ] **Step 4: Add N-element write+revert test**

Append to the existing describe block (end of file, before closing `});`):

```js
  it("writeBundle + revertBundle round-trips a 3-target bundle", () => {
    const before = readConfig();
    const bundle = {
      rule: "llm-multi",
      summary: "3-target test bundle",
      targets: [
        { target: "GAME.critRate", before: before.GAME.critRate, after: +(before.GAME.critRate + 0.02).toFixed(2) },
        { target: "GAME.mpRegen", before: before.GAME.mpRegen, after: before.GAME.mpRegen + 1 },
        { target: "engineer.REJECT SUBMITTAL.dmg",
          before: before.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL").dmg,
          after: before.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL").dmg.map((v) => v + 1) },
      ],
    };
    writeBundle(bundle);
    const mid = readConfig();
    expect(mid.GAME.critRate).toBeCloseTo(bundle.targets[0].after, 6);
    expect(mid.GAME.mpRegen).toBe(bundle.targets[1].after);
    expect(mid.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL").dmg).toEqual(bundle.targets[2].after);
    revertBundle(bundle);
    const after = readConfig();
    expect(after).toEqual(before);
  });
```

- [ ] **Step 5: Add mid-write-failure rollback test**

Append to the same describe block:

```js
  it("writeBundle reverts prior targets and throws if a later target fails", () => {
    const before = readConfig();
    const bundle = {
      rule: "llm-bad",
      summary: "first target ok, second target bad",
      targets: [
        { target: "GAME.critRate", before: before.GAME.critRate, after: +(before.GAME.critRate + 0.02).toFixed(2) },
        { target: "engineer.THIS MOVE DOES NOT EXIST.dmg", before: [10, 20], after: [11, 21] },
      ],
    };
    expect(() => writeBundle(bundle)).toThrow(/no move named/);
    const after = readConfig();
    // First target must have been reverted — we should be bit-identical to before.
    expect(after).toEqual(before);
  });
```

- [ ] **Step 6: Run the applyProposal test file in isolation**

Run: `npx vitest run src/__tests__/tune-applyProposal.test.js`
Expected: all tests pass, including the 2 new ones. Test count grows by 2.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: only `tune-applyProposal.test.js` changed its count (+2). Other suites unaffected because Task 8's scripts/tune.js rewire hasn't landed yet, BUT — `scripts/tune.js` imports `{ writeProposal, revertProposal }` from `./src/tune/applyProposal.js` and these names no longer exist. The CLI script won't be invoked by any test, so `npm test` should still pass. Confirm.

If anything fails: likely a test inside `tune-loop.test.js` stubs `apply.write`/`apply.revert` with bundle-ignorant code. Those stubs continue to work because the loop just calls `apply.write(x)` where `x` is whatever the proposer returned. In Task 7, the loop passes a bundle; in Task 1 and here, the loop still passes the heuristic Proposal. We have a temporal gap: between this task and Task 7, `scripts/tune.js` is broken at runtime but `npm test` stays green because no test runs `scripts/tune.js`. Document this in Step 8's commit message.

- [ ] **Step 8: Commit**

```bash
git add src/tune/applyProposal.js src/__tests__/tune-applyProposal.test.js
git commit -m "refactor(tune): applyProposal write/revert take a ProposalBundle

Phase 2.2b Task 2. Rename writeProposal → writeBundle and revertProposal
→ revertBundle. writeBundle iterates bundle.targets in order and is
transactional — if a later target fails (e.g. unknown move name), prior
writes are reverted before re-throwing. revertBundle applies reverts in
reverse order.

No legacy-Proposal fallback: Phase 2.1 single-target tests updated to
use 1-element bundles. 2 new tests cover N-element round-trip and
mid-write rollback.

Known temporary broken state: scripts/tune.js still imports the old
names and will fail at runtime until Task 8 rewires it. No test
invokes scripts/tune.js, so npm test stays green throughout this and
the following tasks."
```

---

## Task 3: `claudeTransport.js` + fake-exec tests

Thin wrapper around `child_process.execFileSync` with injectable `exec` for tests. No real CLI call ever. Synchronous — keeps the loop synchronous.

**Files:**
- Create: `src/tune/claudeTransport.js`
- Create: `src/__tests__/tune-claudeTransport.test.js`

- [ ] **Step 1: Create `src/tune/claudeTransport.js`**

```js
// Subprocess transport for the Claude Code CLI.
// Synchronous: execFileSync blocks until the child exits or times out.
// exec is injectable so tests never spawn a real subprocess.

import { execFileSync } from "node:child_process";

/**
 * Default exec: invokes `claude -p <prompt> --output-format json --model <model>`
 * with a hard timeout (ms). Returns stdout as a UTF-8 string. Throws on nonzero
 * exit or timeout (the error's .signal property is "SIGTERM" for timeout).
 *
 * No shell interpolation — execFileSync arg-array form avoids shell injection.
 */
function defaultExec({ prompt, model, timeoutMs }) {
  const args = ["-p", prompt, "--output-format", "json", "--model", model];
  return execFileSync("claude", args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,   // 10 MiB — prompt+response can be large
  });
}

/**
 * Creates a transport object with a single `send(prompt) → string` method.
 * Tests inject a fake `exec`.
 */
export function createCliTransport({
  exec = defaultExec,
  model = "claude-sonnet-4-6",
  timeoutMs = 120_000,
} = {}) {
  return {
    send(prompt) {
      if (typeof prompt !== "string" || prompt.length === 0) {
        throw new Error("claudeTransport.send: prompt must be a non-empty string");
      }
      return exec({ prompt, model, timeoutMs });
    },
  };
}
```

- [ ] **Step 2: Create `src/__tests__/tune-claudeTransport.test.js`**

```js
import { describe, it, expect, vi } from "vitest";
import { createCliTransport } from "../tune/claudeTransport.js";

describe("createCliTransport", () => {
  it("send(prompt) forwards prompt, model, and timeoutMs to the injected exec", () => {
    const exec = vi.fn(() => '{"type":"result","result":"ok"}');
    const t = createCliTransport({ exec, model: "claude-opus-4-6", timeoutMs: 1000 });
    const out = t.send("hello");
    expect(out).toBe('{"type":"result","result":"ok"}');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith({
      prompt: "hello",
      model: "claude-opus-4-6",
      timeoutMs: 1000,
    });
  });

  it("uses claude-sonnet-4-6 and 120s timeout by default", () => {
    const exec = vi.fn(() => "stdout");
    const t = createCliTransport({ exec });
    t.send("hi");
    expect(exec).toHaveBeenCalledWith({ prompt: "hi", model: "claude-sonnet-4-6", timeoutMs: 120_000 });
  });

  it("throws if prompt is empty or not a string", () => {
    const exec = vi.fn();
    const t = createCliTransport({ exec });
    expect(() => t.send("")).toThrow(/non-empty string/);
    expect(() => t.send(null)).toThrow(/non-empty string/);
    expect(() => t.send(undefined)).toThrow(/non-empty string/);
    expect(() => t.send(42)).toThrow(/non-empty string/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("propagates exec errors (nonzero exit)", () => {
    const exec = vi.fn(() => { const e = new Error("Command failed"); e.status = 1; throw e; });
    const t = createCliTransport({ exec });
    expect(() => t.send("prompt")).toThrow(/Command failed/);
  });

  it("propagates timeout errors (SIGTERM)", () => {
    const exec = vi.fn(() => { const e = new Error("ETIMEDOUT"); e.signal = "SIGTERM"; throw e; });
    const t = createCliTransport({ exec });
    expect(() => t.send("prompt")).toThrow(/ETIMEDOUT/);
  });
});
```

- [ ] **Step 3: Run the new test file in isolation**

Run: `npx vitest run src/__tests__/tune-claudeTransport.test.js`
Expected: 5 tests pass.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass, count grows by 5 relative to Task 2's end state. No flakiness — everything is in-process with injected exec.

- [ ] **Step 5: Commit**

```bash
git add src/tune/claudeTransport.js src/__tests__/tune-claudeTransport.test.js
git commit -m "feat(tune): add claudeTransport — CLI subprocess with injectable exec

Phase 2.2b Task 3. createCliTransport({ exec, model, timeoutMs }) wraps
child_process.execFileSync for the 'claude -p --output-format json'
subprocess. Arg-array form avoids shell injection. Defaults:
claude-sonnet-4-6, 120s timeout, 10 MiB maxBuffer.

exec is injectable — tests use vi.fn() and verify prompt/model/timeout
propagation, default values, input validation, nonzero-exit passthrough,
and SIGTERM (timeout) passthrough. No real subprocess spawned."
```

---

## Task 4: `llmProposer.js` — `buildPrompt` + tests

Pure function: inputs current config, current report, and history; returns a markdown-structured prompt string. Static prefix first for prompt-cache locality; dynamic sections second. Target 4–6k tokens.

**Files:**
- Create: `src/tune/llmProposer.js` (partial — `buildPrompt` only; `parseBundle` is Task 5, `createLlmProposer` is Task 6)
- Create: `src/__tests__/tune-llmProposer-prompt.test.js`

- [ ] **Step 1: Create `src/tune/llmProposer.js` with `buildPrompt`**

```js
// LLM-backed proposer: buildPrompt + parseBundle + createLlmProposer.
// Pure logic — zero I/O. Imports readConfig from applyProposal only for
// createLlmProposer's propose (Task 6); buildPrompt takes currentState as input.

import { readConfig } from "./applyProposal.js";

// ---- static prompt prefix (cache boundary) ----

const STATIC_PREFIX = `# Role
You are a balance tuner for spec-battle, a turn-based RPG where an
ENGINEER fights a CONTRACTOR using federal-construction-spec language.
Your job is to propose small numeric tweaks to move the simulated
engineer win rate toward 50% in both matchups (random-vs-random and
random-vs-ai).

# Target grammar (STRICT)
Every target in your bundle MUST match one of these two patterns:
- \`GAME.<key>\` — edits content/game.json
- \`<side>.<moveName>.<field>\` — edits content/moves/<side>.json where
  side ∈ {engineer, contractor} and field ∈ {dmg, mp}

# Step-size bounds (REJECTED if exceeded)
- dmg: must be a [min, max] array of integers; shift both bounds by ±1 only
- mp: integer, shift by ±1 only
- GAME rates (critRate, stunChance, slowChance): shift by ±0.02 only, stay in [0, 1]
- GAME multipliers (critMultiplier, weakenedMultiplier, defMultiplier): shift by ±0.05 only, stay > 0
- GAME.mpRegen: integer, shift by ±1 only, stay ≥ 0
- GAME.healRange: [min, max] ints; min shift by ±2, max shift by ±1, min ≤ max

# Response format (STRICT)
Respond with ONLY a single JSON object matching this schema — no prose,
no markdown code fences, no commentary:

{
  "rule": "short-label",
  "summary": "one-line rationale, <=80 chars",
  "targets": [
    { "target": "<path>", "before": <current>, "after": <proposed> }
  ]
}

\`targets\` must have at least 1 element. A single-tweak is a 1-element
bundle. \`before\` values must match the current file state exactly —
do NOT guess; copy from the Current content section below.

# Game primer
- 6 moves per side. Engineer 140HP/70MP, Contractor 150HP/60MP.
- Status: STUNNED (skip turn), SLOWED (visual), WEAKENED (+30% dmg taken), DEF+ (−50% dmg taken).
- MP regens by GAME.mpRegen each turn. Crits fire at GAME.critRate with GAME.critMultiplier damage.

`;

// ---- buildPrompt ----

/**
 * @param {Object} args
 * @param {{ GAME: Object, moves: { engineer: Array, contractor: Array } }} args.currentState
 * @param {{ matchups: Array }} args.currentReport
 * @param {HistoryEntry[]} args.history - loop history; this function picks last 3
 * @param {string|undefined} args.retryError - error string from prior parseBundle failure (optional)
 * @returns {string}
 */
export function buildPrompt({ currentState, currentReport, history, retryError }) {
  const dynamicParts = [];

  dynamicParts.push("# Current content");
  dynamicParts.push("## content/game.json");
  dynamicParts.push("```json");
  dynamicParts.push(JSON.stringify(currentState.GAME, null, 2));
  dynamicParts.push("```");
  dynamicParts.push("## content/moves/engineer.json");
  dynamicParts.push("```json");
  dynamicParts.push(JSON.stringify(currentState.moves.engineer, null, 2));
  dynamicParts.push("```");
  dynamicParts.push("## content/moves/contractor.json");
  dynamicParts.push("```json");
  dynamicParts.push(JSON.stringify(currentState.moves.contractor, null, 2));
  dynamicParts.push("```");

  dynamicParts.push("");
  dynamicParts.push("# Current balance report");
  for (const m of currentReport.matchups) {
    const top5 = Object.entries({ ...m.moveFrequency.engineer, ...m.moveFrequency.contractor })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `  ${k}: ${(v * 100).toFixed(1)}%`)
      .join("\n");
    dynamicParts.push(`## ${m.matchup}`);
    dynamicParts.push(`- engineerWinRate: ${(m.engineerWinRate * 100).toFixed(2)}%`);
    dynamicParts.push(`- avgTurns: ${m.avgTurns.toFixed(1)}`);
    dynamicParts.push(`- top-5 move frequencies:\n${top5}`);
  }

  dynamicParts.push("");
  dynamicParts.push("# Recent history (last 3 iterations, oldest first)");
  const recent = history.filter((h) => h.outcome !== "baseline").slice(-3);
  if (recent.length === 0) {
    dynamicParts.push("(no prior iterations)");
  } else {
    dynamicParts.push("```json");
    dynamicParts.push(JSON.stringify(recent.map((h) => {
      const entry = { iteration: h.iteration, bundle: h.bundle, outcome: h.outcome };
      if (h.worstDistanceBefore !== undefined) entry.worstDistanceBefore = +h.worstDistanceBefore.toFixed(4);
      if (h.worstDistanceAfter !== undefined) entry.worstDistanceAfter = +h.worstDistanceAfter.toFixed(4);
      return entry;
    }), null, 2));
    dynamicParts.push("```");
  }

  if (retryError) {
    dynamicParts.push("");
    dynamicParts.push("# Retry context");
    dynamicParts.push(`Your previous response failed validation: ${retryError}`);
    dynamicParts.push("Emit valid JSON only, matching the schema above.");
  }

  dynamicParts.push("");
  dynamicParts.push("# Task");
  dynamicParts.push("Propose one bundle that moves engineer win rate closer to 50% in");
  dynamicParts.push("the worse matchup without regressing the other by more than 2pp.");
  dynamicParts.push("Respond with ONLY the JSON bundle.");

  return STATIC_PREFIX + dynamicParts.join("\n") + "\n";
}
```

- [ ] **Step 2: Create `src/__tests__/tune-llmProposer-prompt.test.js`**

```js
import { describe, it, expect } from "vitest";
import { buildPrompt } from "../tune/llmProposer.js";

const baseState = {
  GAME: { critRate: 0.12, critMultiplier: 1.6, mpRegen: 4, healRange: [28, 45] },
  moves: {
    engineer: [{ name: "REJECT SUBMITTAL", dmg: [16, 24], mp: 10 }],
    contractor: [{ name: "CLAIM DSC", dmg: [18, 28], mp: 12 }],
  },
};
const baseReport = {
  matchups: [
    { matchup: "random-vs-random", engineerWinRate: 0.865, avgTurns: 12.5,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.4 }, contractor: { "CLAIM DSC": 0.35 } } },
    { matchup: "random-vs-ai", engineerWinRate: 0.715, avgTurns: 18.7,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.3 }, contractor: { "CLAIM DSC": 0.5 } } },
  ],
};

describe("buildPrompt", () => {
  it("starts with the static prefix for prompt-cache locality", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out.startsWith("# Role\n")).toBe(true);
    expect(out).toContain("# Target grammar (STRICT)");
    expect(out).toContain("# Step-size bounds (REJECTED if exceeded)");
    expect(out).toContain("# Response format (STRICT)");
  });

  it("embeds current content as JSON code fences", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out).toContain("## content/game.json");
    expect(out).toContain("## content/moves/engineer.json");
    expect(out).toContain("## content/moves/contractor.json");
    // JSON should be verbatim-embedded
    expect(out).toContain('"critRate": 0.12');
    expect(out).toContain('"REJECT SUBMITTAL"');
  });

  it("summarizes the current balance report per matchup", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out).toContain("## random-vs-random");
    expect(out).toContain("engineerWinRate: 86.50%");
    expect(out).toContain("## random-vs-ai");
    expect(out).toContain("engineerWinRate: 71.50%");
  });

  it("emits '(no prior iterations)' when history is empty or only baseline", () => {
    const out1 = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out1).toContain("(no prior iterations)");
    const out2 = buildPrompt({ currentState: baseState, currentReport: baseReport,
      history: [{ iteration: 0, bundle: null, outcome: "baseline", report: baseReport }] });
    expect(out2).toContain("(no prior iterations)");
  });

  it("embeds last 3 non-baseline history entries in oldest-first order", () => {
    const mkEntry = (i, outcome, extra = {}) => ({
      iteration: i, bundle: { rule: `r${i}`, summary: `s${i}`, targets: [] },
      outcome, report: baseReport, ...extra,
    });
    const history = [
      { iteration: 0, bundle: null, outcome: "baseline", report: baseReport },
      mkEntry(1, "tests-failed", { worstDistanceBefore: 0.365 }),
      mkEntry(2, "accepted", { worstDistanceBefore: 0.365, worstDistanceAfter: 0.320 }),
      mkEntry(3, "not-improvement", { worstDistanceBefore: 0.320 }),
      mkEntry(4, "accepted", { worstDistanceBefore: 0.320, worstDistanceAfter: 0.280 }),
    ];
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
  });

  it("includes retry context when retryError is provided", () => {
    const out = buildPrompt({
      currentState: baseState, currentReport: baseReport, history: [],
      retryError: "targets[0].before mismatch",
    });
    expect(out).toContain("# Retry context");
    expect(out).toContain("targets[0].before mismatch");
  });

  it("ends with the task instruction", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out).toContain("# Task");
    expect(out).toMatch(/Respond with ONLY the JSON bundle\.\s*$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    const b = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 3: Run the new test file**

Run: `npx vitest run src/__tests__/tune-llmProposer-prompt.test.js`
Expected: 8 tests pass.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass, count +8 relative to Task 3's end state.

- [ ] **Step 5: Commit**

```bash
git add src/tune/llmProposer.js src/__tests__/tune-llmProposer-prompt.test.js
git commit -m "feat(tune): add llmProposer.buildPrompt — markdown-structured, cache-aware

Phase 2.2b Task 4. buildPrompt({ currentState, currentReport, history,
retryError }) returns a deterministic markdown prompt with the static
prefix (role, grammar, bounds, schema, primer) before dynamic sections
(content snapshot, balance report summary, last 3 non-baseline history
entries, optional retry context, task instruction).

History entries include worstDistanceBefore/After deltas for accepted
bundles, giving the LLM signal on which levers actually move the sim
(parked-but-shipped per Phase 2.2b brainstorm Q3).

Static prefix comes first for prompt-cache locality. parseBundle and
createLlmProposer are built in Tasks 5 and 6."
```

---

## Task 5: `llmProposer.js` — `parseBundle` + tests

Append `parseBundle` to the llmProposer module. Implements the 3-step ladder (envelope → fence-strip → first-brace extract) plus schema validation. Zero I/O — currentState is passed in.

**Files:**
- Modify: `src/tune/llmProposer.js` (append parseBundle)
- Create: `src/__tests__/tune-llmProposer-parse.test.js`

- [ ] **Step 1: Append `parseBundle` + helpers to `src/tune/llmProposer.js`**

Append at the end of the file (after `buildPrompt`):

```js
// ---- parseBundle ----

const TARGET_RE = /^(GAME\.[a-zA-Z]+|(?:engineer|contractor)\..+\.(?:dmg|mp))$/;

// Step-size validation per target kind.
function validateStep(target, before, after) {
  if (target.startsWith("GAME.")) {
    const key = target.slice("GAME.".length);
    if (["critRate", "stunChance", "slowChance"].includes(key)) {
      if (typeof before !== "number" || typeof after !== "number") return "rate must be numeric";
      if (Math.abs(after - before) > 0.02 + 1e-9) return `${key} step > 0.02`;
      if (after < 0 || after > 1) return `${key} out of [0,1]`;
      return null;
    }
    if (["critMultiplier", "weakenedMultiplier", "defMultiplier"].includes(key)) {
      if (typeof before !== "number" || typeof after !== "number") return "multiplier must be numeric";
      if (Math.abs(after - before) > 0.05 + 1e-9) return `${key} step > 0.05`;
      if (after <= 0) return `${key} must be > 0`;
      return null;
    }
    if (key === "mpRegen") {
      if (!Number.isInteger(before) || !Number.isInteger(after)) return "mpRegen must be integer";
      if (Math.abs(after - before) > 1) return "mpRegen step > 1";
      if (after < 0) return "mpRegen must be >= 0";
      return null;
    }
    if (key === "healRange") {
      if (!Array.isArray(before) || before.length !== 2) return "healRange before must be [min,max]";
      if (!Array.isArray(after) || after.length !== 2) return "healRange after must be [min,max]";
      if (!after.every(Number.isInteger)) return "healRange values must be integers";
      if (Math.abs(after[0] - before[0]) > 2) return "healRange min step > 2";
      if (Math.abs(after[1] - before[1]) > 1) return "healRange max step > 1";
      if (after[0] > after[1]) return "healRange min > max";
      return null;
    }
    return `unknown GAME.${key}`;
  }
  // Move target: <side>.<name>.<field>
  if (target.endsWith(".dmg")) {
    if (!Array.isArray(before) || before.length !== 2) return "dmg before must be [min,max]";
    if (!Array.isArray(after) || after.length !== 2) return "dmg after must be [min,max]";
    if (!after.every(Number.isInteger)) return "dmg values must be integers";
    if (after[0] !== before[0] - 1 && after[0] !== before[0] + 1 && after[0] !== before[0])
      return "dmg[0] step must be -1, 0, or +1";
    if (after[1] !== before[1] - 1 && after[1] !== before[1] + 1 && after[1] !== before[1])
      return "dmg[1] step must be -1, 0, or +1";
    if (after[0] > after[1]) return "dmg min > max";
    if (after[0] < 0) return "dmg min < 0";
    return null;
  }
  if (target.endsWith(".mp")) {
    if (!Number.isInteger(before) || !Number.isInteger(after)) return "mp must be integer";
    if (Math.abs(after - before) > 1) return "mp step > 1";
    if (after < 0) return "mp must be >= 0";
    return null;
  }
  return "unknown field";
}

// Deep equal for scalars + 2-element arrays (the only shapes we use).
function sameBefore(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

// Read the actual current value from currentState for a given target.
function resolveCurrent(currentState, target) {
  if (target.startsWith("GAME.")) {
    const key = target.slice("GAME.".length);
    if (!(key in currentState.GAME)) return { ok: false, error: `unknown key GAME.${key}` };
    return { ok: true, value: currentState.GAME[key] };
  }
  const firstDot = target.indexOf(".");
  const lastDot = target.lastIndexOf(".");
  const side = target.slice(0, firstDot);
  const field = target.slice(lastDot + 1);
  const name = target.slice(firstDot + 1, lastDot);
  const move = currentState.moves[side]?.find((m) => m.name === name);
  if (!move) return { ok: false, error: `no move ${side}.${name}` };
  if (!(field in move)) return { ok: false, error: `move ${name} has no field ${field}` };
  return { ok: true, value: move[field] };
}

// Find the first balanced {...} in a string, respecting string literals.
function firstBalancedObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function extractInnerJson(rawCliOutput) {
  // Step 1: try envelope parse first.
  try {
    const envelope = JSON.parse(rawCliOutput);
    if (envelope && typeof envelope.result === "string") return envelope.result;
  } catch {
    // Not a JSON envelope — treat the raw output as the inner content directly.
  }
  return rawCliOutput;
}

function tryParseAsBundleObject(inner) {
  // Step 2: direct parse.
  try { return { ok: true, obj: JSON.parse(inner) }; } catch {}
  // Step 3: strip code fences.
  const fenceMatch = inner.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try { return { ok: true, obj: JSON.parse(fenceMatch[1]) }; } catch {}
  }
  // Step 4: first balanced object.
  const firstObj = firstBalancedObject(inner);
  if (firstObj) {
    try { return { ok: true, obj: JSON.parse(firstObj) }; } catch {}
  }
  return { ok: false, error: "could not parse JSON from CLI output (tried envelope, fence-strip, brace-extract)" };
}

/**
 * @param {string} rawCliOutput - raw stdout from claude -p --output-format json
 * @param {Object} currentState - { GAME, moves } from readConfig()
 * @returns {{ok: true, bundle: Object} | {ok: false, error: string}}
 */
export function parseBundle(rawCliOutput, currentState) {
  const inner = extractInnerJson(rawCliOutput);
  const parsed = tryParseAsBundleObject(inner);
  if (!parsed.ok) return parsed;
  const obj = parsed.obj;

  // Schema validation.
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "bundle must be a JSON object" };
  if (typeof obj.rule !== "string" || obj.rule.length === 0) return { ok: false, error: "bundle.rule must be non-empty string" };
  if (typeof obj.summary !== "string" || obj.summary.length === 0) return { ok: false, error: "bundle.summary must be non-empty string" };
  if (obj.summary.length > 200) return { ok: false, error: "bundle.summary too long (>200 chars)" };
  if (!Array.isArray(obj.targets) || obj.targets.length === 0) return { ok: false, error: "bundle.targets must be a non-empty array" };

  for (let i = 0; i < obj.targets.length; i++) {
    const t = obj.targets[i];
    if (!t || typeof t !== "object") return { ok: false, error: `targets[${i}] must be object` };
    if (typeof t.target !== "string") return { ok: false, error: `targets[${i}].target must be string` };
    if (!TARGET_RE.test(t.target)) return { ok: false, error: `targets[${i}].target '${t.target}' fails grammar` };

    const resolved = resolveCurrent(currentState, t.target);
    if (!resolved.ok) return { ok: false, error: `targets[${i}]: ${resolved.error}` };
    if (!sameBefore(t.before, resolved.value)) {
      return { ok: false, error: `targets[${i}].before was ${JSON.stringify(t.before)} but current is ${JSON.stringify(resolved.value)}` };
    }

    const stepErr = validateStep(t.target, t.before, t.after);
    if (stepErr) return { ok: false, error: `targets[${i}]: ${stepErr}` };
  }

  return { ok: true, bundle: { rule: obj.rule, summary: obj.summary, targets: obj.targets } };
}
```

- [ ] **Step 2: Create `src/__tests__/tune-llmProposer-parse.test.js`**

```js
import { describe, it, expect } from "vitest";
import { parseBundle } from "../tune/llmProposer.js";

const state = {
  GAME: { critRate: 0.12, critMultiplier: 1.6, mpRegen: 4, healRange: [28, 45], weakenedMultiplier: 1.3 },
  moves: {
    engineer: [{ name: "REJECT SUBMITTAL", dmg: [16, 24], mp: 10 }],
    contractor: [{ name: "CLAIM DSC", dmg: [18, 28], mp: 12 }],
  },
};

// Build a CLI envelope shape: {"type":"result","subtype":"success","result":"<inner>"}
const envelope = (inner) => JSON.stringify({ type: "result", subtype: "success", result: inner });

const validBundle = {
  rule: "llm-test",
  summary: "tweak critRate down",
  targets: [{ target: "GAME.critRate", before: 0.12, after: 0.10 }],
};

describe("parseBundle — happy path", () => {
  it("accepts a valid bundle from a CLI envelope with JSON result", () => {
    const raw = envelope(JSON.stringify(validBundle));
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
    expect(r.bundle).toEqual(validBundle);
  });

  it("accepts a bundle wrapped in ```json fences inside the envelope", () => {
    const raw = envelope("```json\n" + JSON.stringify(validBundle, null, 2) + "\n```");
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
    expect(r.bundle.rule).toBe("llm-test");
  });

  it("accepts a bundle wrapped in bare ``` fences", () => {
    const raw = envelope("```\n" + JSON.stringify(validBundle) + "\n```");
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
  });

  it("accepts a bundle with leading prose (brace-extract fallback)", () => {
    const raw = envelope("Here's the bundle you asked for:\n\n" + JSON.stringify(validBundle));
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
  });

  it("accepts raw JSON without the CLI envelope", () => {
    const raw = JSON.stringify(validBundle);
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
  });

  it("accepts an N-target bundle", () => {
    const b = {
      rule: "multi",
      summary: "three-lever tweak",
      targets: [
        { target: "GAME.critRate", before: 0.12, after: 0.14 },
        { target: "GAME.mpRegen", before: 4, after: 3 },
        { target: "engineer.REJECT SUBMITTAL.dmg", before: [16, 24], after: [15, 23] },
      ],
    };
    const r = parseBundle(envelope(JSON.stringify(b)), state);
    expect(r.ok).toBe(true);
    expect(r.bundle.targets).toHaveLength(3);
  });
});

describe("parseBundle — parse failures", () => {
  it("rejects non-JSON garbage", () => {
    const r = parseBundle("not json at all — no braces either", state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not parse/i);
  });

  it("rejects envelope with non-string result", () => {
    const raw = JSON.stringify({ type: "result", result: 42 });
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(false);
  });
});

describe("parseBundle — schema violations", () => {
  const ok = (bundle) => envelope(JSON.stringify(bundle));

  it("rejects missing rule", () => {
    const r = parseBundle(ok({ summary: "s", targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rule/);
  });

  it("rejects missing summary", () => {
    const r = parseBundle(ok({ rule: "r", targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/summary/);
  });

  it("rejects empty targets array", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: [] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/targets/);
  });

  it("rejects target with bad grammar", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: [{ target: "game.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/grammar/);
  });

  it("rejects target referencing unknown GAME key", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: [{ target: "GAME.nonexistent", before: 0, after: 0 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown/i);
  });

  it("rejects target referencing unknown move", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.NONEXISTENT.dmg", before: [0, 0], after: [1, 1] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no move/i);
  });

  it("rejects before mismatch (LLM hallucinated baseline)", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.critRate", before: 0.99, after: 0.97 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/before was/);
  });

  it("rejects step-size violation on rate", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.critRate", before: 0.12, after: 0.20 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/step > 0\.02/);
  });

  it("rejects step-size violation on multiplier", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.critMultiplier", before: 1.6, after: 1.8 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/step > 0\.05/);
  });

  it("rejects step-size violation on dmg", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.REJECT SUBMITTAL.dmg", before: [16, 24], after: [20, 30] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/step must be/);
  });

  it("accepts ±1 int dmg shift", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.REJECT SUBMITTAL.dmg", before: [16, 24], after: [17, 25] }] }), state);
    expect(r.ok).toBe(true);
  });

  it("rejects healRange out-of-bounds step", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.healRange", before: [28, 45], after: [35, 50] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/healRange/);
  });

  it("rejects targets that aren't an array", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: "not array" }), state);
    expect(r.ok).toBe(false);
  });

  it("rejects summary > 200 chars", () => {
    const r = parseBundle(ok({ rule: "r", summary: "x".repeat(201),
      targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
  });

  it("handles move name with dots if any (first-dot / last-dot split)", () => {
    // Edge case: move name cannot contain dots per grammar, but if a bad target slipped
    // through the regex due to loose "+" matching, resolveCurrent would fail.
    // The grammar regex `/^(?:engineer|contractor)\..+\.(?:dmg|mp)$/` is greedy on `.+`,
    // so "engineer.a.b.dmg" parses as side=engineer, field=dmg, name="a.b".
    // That's a real move-name-with-dots corner case the content doesn't use, but the
    // parser handles it deterministically — verify:
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.a.b.dmg", before: [1, 2], after: [2, 3] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no move/);
  });
});
```

- [ ] **Step 3: Run the parse test file**

Run: `npx vitest run src/__tests__/tune-llmProposer-parse.test.js`
Expected: all tests pass (22 tests total: 6 happy + 2 parse-fail + 14 schema).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass, count +22 relative to Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/tune/llmProposer.js src/__tests__/tune-llmProposer-parse.test.js
git commit -m "feat(tune): add llmProposer.parseBundle — 3-step ladder + schema validation

Phase 2.2b Task 5. parseBundle(rawCliOutput, currentState):
  1. Extract .result from CLI envelope (or treat raw as inner)
  2. Direct JSON.parse on inner
  3. Strip \`\`\`json/\`\`\` fences, retry
  4. First balanced {...} extract, retry
  5. Schema: rule/summary/targets, grammar regex, before matches
     currentState, step-size bounds per field kind

Returns {ok: true, bundle} or {ok: false, error: <actionable-string>}.
Error messages are specific so the bounded loop retry gives the LLM
usable feedback.

22 fixture tests cover happy path (envelope, fences, prose, N-target,
raw-JSON), parse failures, and each schema violation class."
```

---

## Task 6: `llmProposer.js` — `createLlmProposer` glue + tests

Final piece of the LLM proposer module: compose `buildPrompt`, the injected transport, `parseBundle`, and `readConfig` into a `propose(report, iteration, history, opts?) → ProposeResult`.

**Files:**
- Modify: `src/tune/llmProposer.js` (append createLlmProposer)
- Create: `src/__tests__/tune-llmProposer-propose.test.js`

- [ ] **Step 1: Append `createLlmProposer` to `src/tune/llmProposer.js`**

Append at end of file:

```js
// ---- createLlmProposer ----

/**
 * @param {Object} deps
 * @param {{ send(prompt: string): string }} deps.transport  - from createCliTransport
 * @param {() => Object} [deps.getCurrentState]              - defaults to readConfig(); injectable for tests
 * @returns {{ propose(report, iteration, history, opts?): ProposeResult }}
 */
export function createLlmProposer({ transport, getCurrentState = readConfig }) {
  return {
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
        // Return null so the loop stops with reason "exhausted".
        return null;
      }

      return parseBundle(raw, currentState);
    },
  };
}
```

- [ ] **Step 2: Create `src/__tests__/tune-llmProposer-propose.test.js`**

```js
import { describe, it, expect, vi } from "vitest";
import { createLlmProposer } from "../tune/llmProposer.js";

const state = {
  GAME: { critRate: 0.12, critMultiplier: 1.6, mpRegen: 4, healRange: [28, 45], weakenedMultiplier: 1.3 },
  moves: {
    engineer: [{ name: "REJECT SUBMITTAL", dmg: [16, 24], mp: 10 }],
    contractor: [{ name: "CLAIM DSC", dmg: [18, 28], mp: 12 }],
  },
};
const report = {
  matchups: [
    { matchup: "random-vs-random", engineerWinRate: 0.865, avgTurns: 12.5,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.4 }, contractor: { "CLAIM DSC": 0.35 } } },
    { matchup: "random-vs-ai", engineerWinRate: 0.715, avgTurns: 18.7,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.3 }, contractor: { "CLAIM DSC": 0.5 } } },
  ],
};
const validBundle = {
  rule: "llm-test",
  summary: "tweak critRate down",
  targets: [{ target: "GAME.critRate", before: 0.12, after: 0.10 }],
};
const envelope = (inner) => JSON.stringify({ type: "result", subtype: "success", result: inner });

describe("createLlmProposer.propose", () => {
  it("sends a prompt via transport and returns {ok:true, bundle} on valid response", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const r = proposer.propose(report, 0, []);
    expect(send).toHaveBeenCalledTimes(1);
    const prompt = send.mock.calls[0][0];
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("# Role");
    expect(r).toEqual({ ok: true, bundle: validBundle });
  });

  it("returns {ok:false} when transport returns garbage", () => {
    const send = vi.fn(() => "garbage no json");
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const r = proposer.propose(report, 0, []);
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("returns null when transport throws (non-recoverable)", () => {
    const send = vi.fn(() => { throw new Error("ENOENT: claude not found"); });
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const r = proposer.propose(report, 0, []);
    expect(r).toBeNull();
  });

  it("threads retryError into the prompt when opts.retryError is provided", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    proposer.propose(report, 0, [], { retryError: "targets[0].before mismatch" });
    const prompt = send.mock.calls[0][0];
    expect(prompt).toContain("# Retry context");
    expect(prompt).toContain("targets[0].before mismatch");
  });

  it("omits retry section when opts.retryError is absent", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    proposer.propose(report, 0, []);
    const prompt = send.mock.calls[0][0];
    expect(prompt).not.toContain("# Retry context");
  });

  it("passes history to buildPrompt (recent entries appear in prompt)", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const history = [
      { iteration: 1, bundle: { rule: "prior", summary: "x", targets: [] },
        outcome: "accepted", report, worstDistanceBefore: 0.365, worstDistanceAfter: 0.320 },
    ];
    proposer.propose(report, 1, history);
    const prompt = send.mock.calls[0][0];
    expect(prompt).toContain('"iteration": 1');
    expect(prompt).toContain('"worstDistanceAfter": 0.32');
  });
});
```

- [ ] **Step 3: Run the new test file**

Run: `npx vitest run src/__tests__/tune-llmProposer-propose.test.js`
Expected: 6 tests pass.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all pass, count +6 relative to Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/tune/llmProposer.js src/__tests__/tune-llmProposer-propose.test.js
git commit -m "feat(tune): add createLlmProposer — glue buildPrompt/transport/parseBundle

Phase 2.2b Task 6. createLlmProposer({ transport, getCurrentState? })
returns { propose(report, iteration, history, opts?) }.

propose reads currentState via getCurrentState (defaults to readConfig),
builds a prompt, calls transport.send, and returns parseBundle's result.
If transport.send throws (CLI missing, timeout, nonzero exit), propose
returns null — signaling the loop to stop with reason 'exhausted'.

6 tests use vi.fn() transports and injected state; zero subprocesses.
Covers happy path, parse failure passthrough, transport failure → null,
retryError prompt threading, retry-absent omission, and history
propagation."
```

---

## Task 7: `loop.js` — retry wrapper, history delta capture, new outcome types

The biggest task. Adds the bounded retry path, new history shape with delta capture, and refactors `summarizeHistory` to the new entry shape. Update existing tune-loop tests to the new history shape and add retry/invalid-output/write-failed cases.

**Files:**
- Modify: `src/tune/loop.js`
- Modify: `src/__tests__/tune-loop.test.js`

- [ ] **Step 1: Read current tune-loop tests**

Run: Read `src/__tests__/tune-loop.test.js`.

Inventory:
- Tests that assume the old history shape `{ report, proposal }`.
- Tests that assume the old boolean `accepted` parallel array.
- Tests that mock `apply.write`/`apply.revert` — note what signature they use.
- Tests that use `proposer: { propose }` — note what `propose` returns.

All tests using the old history shape need updates; all proposer mocks need to return `{ok:true, bundle}` or a wrapped legacy Proposal (via a tiny `toBundle` helper if you want to minimize diff). Prefer updating tests to emit bundles directly — clearer intent.

- [ ] **Step 2: Rewrite `src/tune/loop.js`**

Replace the entire file with:

```js
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

  // Runs one propose call with optional retryError; returns ProposeResult.
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
```

- [ ] **Step 3: Update existing tune-loop tests to new history shape + new proposer return shape**

For every test in `src/__tests__/tune-loop.test.js`:

- Replace `proposer.propose = (r, i) => ({ rule, target, before, after, summary })` mocks with `proposer.propose = (r, i, history, opts) => ({ ok: true, bundle: { rule, summary, targets: [{ target, before, after }] } })`.
- Replace assertions of `history[i].proposal` with `history[i].bundle`.
- Replace assertions of `accepted[i]` with `history[i].outcome === "accepted"`.
- Replace `history[i].report` assertions — same shape, unchanged.
- Update `apply.write`/`apply.revert` mocks: they now receive a bundle, not a proposal. If the mock just counts calls, no change needed; if it inspects `.target`, inspect `.targets[0].target` instead.
- If any test passes explicit `maxIterations: 50` specifically because 50 was the default, update to a smaller value if the test's intent was "run until exhaustion", or leave explicit 50 if the test was testing that specific number.
- Any test asserting that `history[0]` is the baseline entry still works — now it has `outcome: "baseline"` and no `worstDistanceBefore/After`.

This is mechanical; expect ~15–30 line edits across 5–10 tests.

- [ ] **Step 4: Add new tests — retry, invalid-output, write-failed, delta capture**

Append inside the top-level `describe("runLoop", ...)` block:

```js
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
      const bundle = { rule: "r", summary: "s",
        targets: [{ target: "engineer.NONEXISTENT.dmg", before: [1, 2], after: [2, 3] }] };
      const result = runLoop({
        runSim: () => baseReport,
        runTests: () => ({ ok: true }),
        git: { commitAll: () => {} },
        fs: { existsSync: () => false, writeFileSync: () => {}, unlinkSync: () => {} },
        clock: { now: () => 0 },
        proposer: { propose: () => ({ ok: true, bundle }) },
        apply: { write: () => { throw new Error("no move named"); }, revert: () => {} },
        convergence: { isConverged: () => false, isImprovement: () => false },
        maxIterations: 1,
      });
      const wf = result.history.find((h) => h.outcome === "write-failed");
      expect(wf).toBeTruthy();
      expect(wf.bundle).toEqual(bundle);
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
    });
  });
```

- [ ] **Step 5: Run the tune-loop test file**

Run: `npx vitest run src/__tests__/tune-loop.test.js`
Expected: all tests pass. If the history-shape migration in Step 3 missed a test, it'll fail here — fix and re-run.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass. Count changes relative to Task 6: +4 new tests (2 retry + 1 write-failed + 1 delta-capture). Minus: any old tests that were merged/folded during Step 3's migration (if any). Net should be around +4.

- [ ] **Step 7: Commit**

```bash
git add src/tune/loop.js src/__tests__/tune-loop.test.js
git commit -m "feat(tune): loop adds bounded retry, new outcomes, worst-distance deltas

Phase 2.2b Task 7. runLoop changes:
- New proposer contract: propose(report, iteration, history, opts?)
  returns ProposeResult = {ok:true, bundle} | {ok:false, error} | null.
- Bounded 1-retry: on {ok:false}, loop re-calls proposer with the error
  as opts.retryError. If retry also fails (or returns null), records
  outcome 'invalid-output' and advances.
- New outcomes in history entries: baseline (iter 0), accepted,
  not-improvement, tests-failed, invalid-output, write-failed.
- History entries carry worstDistanceBefore always (when sim ran) and
  worstDistanceAfter ONLY on accepted entries — gives the LLM delta
  signal for lever effectiveness (Q3 resolution).
- write-failed: if apply.write throws (applyProposal's transactional
  mid-write rollback preserves file state), records the outcome and
  advances.
- summarizeHistory rewritten to consume the new entry shape.

tune-loop tests migrated to bundle-shaped mocks and new history shape.
4 new tests cover retry-fail, retry-success, write-failed, and delta
capture."
```

---

## Task 8: `scripts/tune.js` — env-var selection + heuristic adapter

The composition root. Wires up the env-var selection and the heuristic-to-bundle adapter. Also restores runtime correctness after Task 2's rename break.

**Files:**
- Modify: `scripts/tune.js`

- [ ] **Step 1: Rewrite `scripts/tune.js`**

Replace the file contents with:

```js
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

import { execSync } from "node:child_process";
import fs from "node:fs";
import { runBatch } from "../src/sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../src/sim/policies.js";
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
const maxIterations = flag("max-iters", 30);
const maxWallMs = flag("max-wall-ms", 45 * 60 * 1000);

function runSim() {
  const count = 200;
  const startSeed = 1;
  const matchups = [
    runBatch({ startSeed, count, engPolicy: randomPolicy, conPolicy: randomPolicy,
               engPolicyName: "random", conPolicyName: "random" }),
    runBatch({ startSeed, count, engPolicy: randomPolicy, conPolicy: aiPolicy,
               engPolicyName: "random", conPolicyName: "ai" }),
  ];
  return { matchups };
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
  const kind = process.env.TUNE_PROPOSER ?? "heuristic";
  if (kind === "heuristic") return createHeuristicAdapter(heuristicPropose);
  if (kind === "llm") {
    const model = process.env.TUNE_MODEL ?? "claude-sonnet-4-6";
    const timeoutMs = Number(process.env.TUNE_TIMEOUT_MS ?? 120_000);
    return createLlmProposer({ transport: createCliTransport({ model, timeoutMs }) });
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
if (!dryRun) {
  console.log(`[tune] summary:  tuning-summary.md`);
  console.log(`[tune] next baseline: balance-baseline.next.json`);
  console.log(`[tune] run 'npm run sim:update-baseline' to accept.`);
}
```

Note the default `maxIterations` and `maxWallMs` in `flag()` calls now match the new loop defaults (30 / 45min) — if a user passes `--max-iters=20`, that still wins. The flag defaults were updated here to match Task 1's loop default change for internal consistency.

- [ ] **Step 2: Verify heuristic path still runs end-to-end**

Run: `npm run tune:dry-run`
Expected: 2 iterations, no writes, exits cleanly. Confirms Task 2's rename is correctly re-plumbed here.

- [ ] **Step 3: Verify LLM dry-run script exists and has correct wiring**

Run: `npm run tune:llm -- --dry-run` (or `TUNE_PROPOSER=llm npm run tune:dry-run`).

Expected outcomes:
- If the `claude` CLI is installed and authenticated: 2 iterations run with real CLI calls, no writes, exits cleanly. This is acceptance criterion 2 from ROADMAP.
- If `claude` CLI is not installed: the first `propose` throws on transport.send → `createLlmProposer` returns null → loop finalizes with `reason: "exhausted"`. Script exits 0 (the loop did what it could). Stdout shows `[tune] stopped: exhausted`.

Either outcome is acceptable for Task 8 completion — we're verifying wiring, not that the user has `claude` installed. Note which outcome you observed in the commit message.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all pass. `scripts/tune.js` isn't exercised by any test, but `npm test` should succeed regardless.

- [ ] **Step 5: Commit**

```bash
git add scripts/tune.js
git commit -m "feat(tune): env-var proposer selection + heuristic-to-bundle adapter

Phase 2.2b Task 8. scripts/tune.js:
- TUNE_PROPOSER=heuristic (default) | llm selects the proposer.
- createHeuristicAdapter wraps the Phase 2.1 Proposal output into a
  1-element bundle conforming to the Phase 2.2b ProposeResult shape.
  No second applyProposal code path — wrapping happens at the
  composition root only.
- TUNE_MODEL and TUNE_TIMEOUT_MS env vars control LLM transport.
- Default --max-iters and --max-wall-ms flag fallbacks updated to
  30 / 45min to match the loop defaults from Task 1.
- applyProposal imports updated to writeBundle / revertBundle
  (closing the temporary broken-runtime state introduced in Task 2).

tune:dry-run confirmed heuristic path works end-to-end."
```

---

## Task 9: CLAUDE.md update + final smoke verification

Document the new proposer path. Run the manual end-to-end check for acceptance criteria 1, 4, 5.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add LLM proposer subsection to CLAUDE.md**

In `CLAUDE.md`, locate the "## Tuning harness" section. At the end of that section (after the existing bullets about dry-run, kill switch, vitest parallelism, etc.), append:

```markdown
### LLM proposer (Phase 2.2b)

- `TUNE_PROPOSER=llm npm run tune` (or `npm run tune:llm`) selects the Claude Code CLI subprocess proposer. Default path (no env var) uses the Phase 2.1 heuristic proposer unchanged.
- Transport: `src/tune/claudeTransport.js` spawns `claude -p '<prompt>' --output-format json --model <model>` via `child_process.execFileSync` (no shell, arg-array form). Uses your existing `claude` CLI auth.
- Default model `claude-sonnet-4-6`; override with `TUNE_MODEL=claude-opus-4-6`. Default timeout 120s per call; override with `TUNE_TIMEOUT_MS=180000`.
- Proposer emits `ProposalBundle = { rule, summary, targets: [{target, before, after}, ...] }`. One iteration can move multiple levers coherently.
- Invalid LLM output triggers one bounded retry with the parse/validation error as context. If the retry also fails, the iteration is skipped (outcome: `"invalid-output"`).
- Budget defaults for the LLM path: 30 iterations / 45 minutes wall-clock. Override with `--max-iters=N --max-wall-ms=N` as usual.
- `tune:llm` script is bash-native env-var syntax; run under Git Bash or a POSIX shell on Windows, not cmd.exe. (Or invoke with `cross-env`-style shims if your shell doesn't support it.)
- No real CLI call is made from any unit test — `llmProposer.js` and `claudeTransport.js` are fixture- and fake-exec-tested. Verify wiring with `TUNE_PROPOSER=llm npm run tune:dry-run` (2 iterations, real CLI, no writes).
```

- [ ] **Step 2: Update the "Test Structure" table in CLAUDE.md**

Locate the "### Test Structure" section. Add rows for the new test files:

```markdown
| `tune-claudeTransport` | createCliTransport fake-exec: success, nonzero exit, timeout, input validation |
| `tune-llmProposer-prompt` | buildPrompt shape: static prefix, content embedding, history with deltas, retry context |
| `tune-llmProposer-parse` | parseBundle ladder (envelope/fences/brace-extract) + schema + step-size violations |
| `tune-llmProposer-propose` | createLlmProposer glue with fake transport: happy path, parse passthrough, null on transport throw |
```

- [ ] **Step 3: Update the `tune-applyProposal` row to reflect bundle shape**

Locate the `tune-applyProposal` row in the table. Replace its description with:

```markdown
| `tune-applyProposal` | Bundle write/revert against `content/game.json` + moves files; transactional mid-write rollback |
```

- [ ] **Step 4: Update the `tune-loop` row**

Locate the `tune-loop` row. Replace its description with:

```markdown
| `tune-loop` | Orchestrator: convergence, budget, kill-switch, improvement gating, bounded retry, write-failed/invalid-output outcomes |
```

- [ ] **Step 5: Run full suite once more to establish the clean-green end state**

Run: `npm test`
Expected: all tests pass. Note the total count (previously 275; after Task 2's +2, Task 3's +5, Task 4's +8, Task 5's +22, Task 6's +6, Task 7's +4 → expected ~322). Record the exact count in the commit message.

- [ ] **Step 6: Run heuristic path smoke check**

Run: `npm run tune:dry-run`
Expected: runs 2 iterations, exits cleanly, no file writes. This is acceptance criterion 4: Phase 2.1 heuristic path still works.

- [ ] **Step 7 (manual, if `claude` CLI installed): LLM dry-run smoke**

Run: `TUNE_PROPOSER=llm npm run tune:dry-run`

Expected outcomes:
- 2 iterations run with real CLI calls, no file writes. Each iteration logs the bundle summary. Exit code 0.
- OR: first propose returns null (CLI not installed) → loop exits with `exhausted`. Also acceptable.

If the first outcome: congratulations, acceptance criterion 2 is confirmed locally. If the second: acceptance criterion 2 depends on reviewer-machine CLI availability; note this in the commit body.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): document Phase 2.2b LLM proposer path

Adds 'LLM proposer (Phase 2.2b)' subsection to the Tuning harness
section covering TUNE_PROPOSER env var selection, transport defaults
(claude-sonnet-4-6, 120s timeout), bundle shape, bounded retry, and
30/45min budget defaults.

Test Structure table extended with rows for tune-claudeTransport,
tune-llmProposer-prompt, tune-llmProposer-parse, tune-llmProposer-
propose. tune-applyProposal and tune-loop rows updated for bundle
shape + new outcomes.

End state: <NNN> tests passing. Heuristic tune:dry-run verified
clean. LLM tune:dry-run verified <locally / pending reviewer>."
```

Replace `<NNN>` with the actual count from Step 5 and the LLM smoke result from Step 7.

- [ ] **Step 9: Verify ROADMAP Phase 2.2b acceptance criteria**

Re-read `ROADMAP.md` § Phase 2.2b Acceptance criteria and check each:

1. **`npm run tune:llm` runs end-to-end; exits cleanly on convergence, budget, or abort. Commits accepted bundles. Writes `balance-baseline.next.json` + `tuning-summary.md` on exit.** → Wiring is present (Task 8). End-to-end production run is NOT part of plan execution — it's a separate human-invoked activity. This AC is "the machinery exists," not "I ran it for 45 minutes."
2. **`TUNE_PROPOSER=llm npm run tune:dry-run` runs 2 iterations (real CLI calls, no writes/commits).** → Verified in Step 7 if local CLI was available. Otherwise deferred to reviewer.
3. **No real CLI call in any unit test. All LLM-path logic covered by fixtures.** → `tune-claudeTransport.test.js` uses fake exec; `tune-llmProposer-*.test.js` use fixture strings; `tune-llmProposer-propose.test.js` uses vi.fn() transports. No subprocess spawned anywhere in the test suite. ✓
4. **All existing tests stay green. Phase 2.1 heuristic `npm run tune` path still works.** → Verified by Step 5 (tests) and Step 6 (heuristic dry-run). ✓
5. **Tuning run terminates with convergence OR a tuning-summary.md documenting the new ceiling.** → Machinery exists (Task 7's summarizeHistory + loop.finalize). Actual production-run ceiling analysis is a follow-up human activity.

- [ ] **Step 10: Announce Phase 2.2b completion**

Phase 2.2b is done on the branch. Ready for:
- Final branch-level code review (Opus subagent, per user's workflow).
- PR against master.
- Optional: production tuning run (`npm run tune:llm`) by the user.

---

## Self-review (inline, for the plan author)

**Spec coverage:**
- AC1 (tune:llm end-to-end) → wiring in Tasks 1, 7, 8.
- AC2 (LLM dry-run) → Task 8 Step 3 and Task 9 Step 7.
- AC3 (no real CLI in tests) → Tasks 3, 4, 5, 6 all use injected fakes.
- AC4 (existing tests + heuristic path) → Tasks 2, 7 (test migration), 9 (smoke).
- AC5 (convergence or tuning-summary) → Task 7 (summarizeHistory refactor).

**Brainstorm-resolution coverage:**
- Q1 (dedupe) — deferred. No dedupe logic in any task. ✓
- Q2 (parse ladder) — implemented as 3-step in Task 5 `parseBundle`. ✓
- Q3 (delta signal in history) — Task 7 captures `worstDistanceBefore/After` on accepted entries; Task 4 `buildPrompt` embeds them in the history prompt section. ✓

**Placeholder scan:** no TBD/TODO strings; every task has real code; no "add appropriate error handling" hand-waves. `<NNN>` in Task 9 Step 8 is a literal template slot filled at execution time with the test count — not a placeholder in the plan-failure sense.

**Type consistency:** `ProposalBundle`, `BundleTarget`, `HistoryEntry`, `ProposeResult` shapes defined once in Design Contracts and used consistently across tasks. `writeBundle` / `revertBundle` names are consistent from Task 2 onward. Function signatures (`propose(report, iteration, history, opts?)`, `buildPrompt({currentState, currentReport, history, retryError})`, `parseBundle(rawCliOutput, currentState)`) are consistent across task bodies and tests.

**Scope check:** Single plan; 9 tasks; ~1 commit per task. All within Phase 2.2b per ROADMAP. No creep into Phase 3 (BO) or Phase 4 (LLM player).

**Known temporary broken states:**
- After Task 2 and before Task 8, `scripts/tune.js` imports `writeProposal`/`revertProposal` which no longer exist. `npm test` stays green (no test runs `scripts/tune.js`), but `npm run tune:dry-run` would fail. This is explicitly noted in Task 2's commit message; execution can proceed through Tasks 3–7 without hitting it because those tasks only run `npm test`. Task 8 restores `scripts/tune.js` to working order.
