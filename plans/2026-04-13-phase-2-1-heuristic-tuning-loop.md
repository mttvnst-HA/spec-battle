# Phase 2.1 — Heuristic Tuning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run tune` runs a heuristic tuning loop that proposes tweaks to `GAME` constants and per-move stats, verifies each via `npm test` + in-process `runBatch` sim, commits accepted changes, and stops at convergence / budget / kill-switch. The committed `balance-baseline.json` is never written by the loop; the human accepts via `npm run sim:update-baseline` after review.

**Architecture:** Small, pure-JS modules under `src/tune/`. A `loop` orchestrates: `proposer` reads the last report and emits a `Proposal`; `applyProposal` writes/reverts the proposal against `content/game.json` + `content/moves/*.json`; `convergence` decides stop. `gitOps` is a thin `child_process` wrapper with injectable exec. Sim runs in-process via existing `runBatch`. Tests pre-declared `SKIP_BALANCE_REGRESSION=1` during tuning so the regression test doesn't fight the loop.

**Tech Stack:** JavaScript (ES modules), Vite, Vitest. Node ≥22 (JSON import attributes). No new dependencies.

---

## File Structure

**New files:**
- `content/game.json` — extracted `GAME` config, editable by proposer
- `src/tune/convergence.js` — pure functions: band check, improvement check, distance metric
- `src/__tests__/tune-convergence.test.js`
- `src/tune/applyProposal.js` — read/write/revert a proposal against `content/game.json` + `content/moves/*.json`
- `src/__tests__/tune-applyProposal.test.js`
- `src/tune/proposer.js` — round-robin rule library → `propose(report, iteration) → Proposal | null`
- `src/__tests__/tune-proposer.test.js`
- `src/tune/gitOps.js` — `commitAll(message, { exec })` wrapper
- `src/__tests__/tune-gitOps.test.js`
- `src/tune/loop.js` — main loop: `runLoop({ runSim, runTests, git, fs, clock, ... })`
- `src/__tests__/tune-loop.test.js` — includes the kill-switch test
- `scripts/tune.js` — CLI entry

**Modified files:**
- `src/constants.js` — `GAME` becomes a re-export of `content/game.json`
- `src/__tests__/balance-regression.test.js` — skip when `process.env.SKIP_BALANCE_REGRESSION === "1"`
- `.gitignore` — add `.tuning-abort`, `tuning-summary.md`, `balance-baseline.next.json`
- `package.json` — add `tune` and `tune:dry-run` scripts

Files under `src/tune/` are kept small and single-purpose. `loop.js` is the only one that does I/O; it takes injectable `runSim`, `runTests`, `git`, `fs`, `clock` so its test doesn't shell out.

---

## Design Contracts

Read these before starting. Later tasks reference them by name.

### Proposal shape

```js
/**
 * @typedef {Object} Proposal
 * @property {string} rule        - rule name, e.g. "nerf-top-usage-move"
 * @property {string} target      - dotted path, e.g. "GAME.critMultiplier" OR "engineer.REJECT SUBMITTAL.dmg"
 * @property {*}      before      - current value (scalar or [min, max])
 * @property {*}      after       - proposed value (same shape as before)
 * @property {string} summary     - one-line human-readable, used in commit message
 */
```

Target path grammar:
- `GAME.<key>` — edits `content/game.json` at `[key]`
- `<side>.<moveName>.<field>` — edits `content/moves/<side>.json`, finds move by `name === moveName`, edits `move[field]`. `side` is `"engineer"` or `"contractor"`. `field` is `dmg`, `mp`, or (reserved) `effect`.

### BalanceReport

As produced by `runBatch` (see `src/sim/runBatch.js`). Phase 2.1 treats the report as the *input* to the proposer and as the *metric* for acceptance.

### `isConverged(history)`

- Input: `history` — array of per-iteration reports, newest last. Each entry is the two-matchup report produced that iteration (shape: `{ matchups: [BalanceReport, BalanceReport] }`).
- Returns `true` iff `history.length >= 3` AND each of the last 3 entries has **both** matchups with `engineerWinRate ∈ [0.45, 0.55]`.

### `isImprovement(prev, curr)`

- Inputs: `prev` and `curr`, each `{ matchups: [BalanceReport, BalanceReport] }`.
- Let `distance(m) = Math.abs(m.engineerWinRate - 0.5)` per matchup.
- Let `worst(r) = Math.max(...r.matchups.map(distance))`.
- Returns `true` iff `worst(curr) < worst(prev)` AND for every matchup `distance(curr matchup) - distance(prev matchup) <= 0.02`.

### Proposer contract

- `propose(report, iteration) → Proposal | null`
- Pure function. No filesystem reads — the proposer trusts the caller to pass the current report.
- Round-robin: iteration `i` tries `rules[i % rules.length]` first; if that rule returns null, falls through to the next rule, and so on, wrapping. Returns null if every rule declines.

Rules (Phase 2.1 library, priority order):
1. **nerf-top-usage-move** — identify the dominant side (side with larger max `engineerWinRate` deviation from 0.5 across matchups); pick its most-frequently-used move; if that move's `dmg` max can drop by 1 (≥ its min + 1), drop both bounds by 1; else raise its `mp` by 1.
2. **buff-weak-side-top-move** — identify losing side; pick its move with highest `mp` cost; if its `dmg` max can rise by 1, raise both bounds by 1.
3. **lower-crit-multiplier** — if average `avgTurns` < 14 across matchups, lower `GAME.critMultiplier` by 0.05 (floor 1.1).
4. **trim-mp-regen** — if dominant side wins `≥ 60%` and uses MP-costly moves (avg MP cost of top 2 moves > 10), lower `GAME.mpRegen` by 1 (floor 2).
5. **tame-weaken** — if dominant side wins `≥ 60%`, lower `GAME.weakenedMultiplier` by 0.05 (floor 1.05).
6. **raise-heal-floor** — if contractor is the losing side, raise `GAME.healRange[0]` by 2 (cap 45).

Clamp logic lives inside each rule (returns null instead of an out-of-bounds proposal). No new rules in Phase 2.1.

### Loop contract

```js
runLoop({
  runSim,          // ({ seed, count }) => { matchups: [BalanceReport, BalanceReport] }
  runTests,        // () => { ok: boolean, output: string }
  git,             // { commitAll(msg): void }
  fs,              // { existsSync(p), readFileSync(p), writeFileSync(p, data), unlinkSync(p) }
  clock,           // { now(): number }
  proposer,        // { propose(report, iteration): Proposal | null }
  apply,           // { write(proposal): void, revert(proposal): void }
  convergence,     // { isConverged(history): boolean, isImprovement(prev, curr): boolean }
  maxIterations,   // default 50
  maxWallMs,       // default 15 * 60 * 1000
  abortFile,       // default ".tuning-abort"
  summaryFile,     // default "tuning-summary.md"
  nextBaselineFile,// default "balance-baseline.next.json"
  dryRun,          // if true: no git, no file writes, halt after 2 iterations
  log,             // (msg) => void
}) → { reason: "converged" | "aborted" | "budget-iters" | "budget-wall" | "exhausted", history, best }
```

Loop behavior per iteration (abbreviated):
1. Check abort file → stop "aborted".
2. Check clock → stop "budget-wall".
3. Check iteration count → stop "budget-iters".
4. If first iteration: run baseline sim; record report; go to 5. Else check `isConverged(history)` → stop "converged".
5. Ask proposer for a proposal given `current` report + `iteration`. If null → stop "exhausted".
6. `apply.write(proposal)`; run `runTests()`. If !ok → `apply.revert(proposal)`, push `current` to history (no change), continue.
7. `runSim()` → `candidate`. If `isImprovement(current, candidate)` → `git.commitAll(...)`, push `candidate` to history, set `current = candidate`. Else `apply.revert(proposal)`, push `current` to history (stable), continue.
8. Loop.

On stop: write `summaryFile` (markdown table of iteration / proposal / accepted / worstDistance) and `nextBaselineFile` (best-so-far report, full JSON).

---

## Task 1: Bootstrap — gitignore + regression opt-out

Unblocks the whole plan. No new modules.

**Files:**
- Modify: `.gitignore`
- Modify: `src/__tests__/balance-regression.test.js`

- [ ] **Step 1: Extend `.gitignore`**

Current `.gitignore`:
```
node_modules
dist
.vite
balance-report.json
```

Append:
```
.tuning-abort
tuning-summary.md
balance-baseline.next.json
```

Final file has 7 entries. Keep the trailing newline.

- [ ] **Step 2: Write a failing test for the regression skip behavior**

Append to `src/__tests__/balance-regression.test.js` (before the final `});` of the top-level describe):

```js
  describe("SKIP_BALANCE_REGRESSION env var", () => {
    it("is honored as a string '1' to skip", () => {
      // This test just asserts the env-gate mechanism exists in the source.
      // The actual skip is verified by Step 3 below: running with the env var
      // set should produce 0 test failures even if the baseline drifted.
      const src = fs.readFileSync(
        path.resolve(__dirname, "./balance-regression.test.js"),
        "utf-8",
      );
      expect(src).toMatch(/process\.env\.SKIP_BALANCE_REGRESSION\s*===\s*["']1["']/);
    });
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/__tests__/balance-regression.test.js`
Expected: new test FAILS (source does not yet contain the env check).

- [ ] **Step 4: Implement the opt-out**

Change the top-level `describe("balance regression", () => {` block to gate on the env var. Add a `describe.skipIf` replacement using `it.skipIf`. Simplest form — change:

```js
describe("balance regression", () => {
  for (const baselineMatchup of baseline.matchups) {
    it(`${baselineMatchup.matchup} matches baseline within tolerance`, () => {
```

to:

```js
describe("balance regression", () => {
  const skip = process.env.SKIP_BALANCE_REGRESSION === "1";
  for (const baselineMatchup of baseline.matchups) {
    it.skipIf(skip)(`${baselineMatchup.matchup} matches baseline within tolerance`, () => {
```

Leave the rest of the file unchanged.

- [ ] **Step 5: Run all tests to verify**

Run: `npm test`
Expected: all 236 existing tests pass + new "is honored" test passes → 237 pass total.

Also verify the skip works:

Run (bash): `SKIP_BALANCE_REGRESSION=1 npx vitest run src/__tests__/balance-regression.test.js`
Expected: 2 skipped (one per matchup) + 1 passed (the env-gate source check) = 3 tests reported, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add .gitignore src/__tests__/balance-regression.test.js
git commit -m "feat(tune): gitignore + SKIP_BALANCE_REGRESSION opt-out for tuning loop"
```

---

## Task 2: Extract `GAME` to `content/game.json`

The tuner needs to edit `GAME` scalars. Editing a JSON file is safer than regex-editing a JS literal. This is a one-file extraction — `GAME` is already a flat object.

**Files:**
- Create: `content/game.json`
- Modify: `src/constants.js`

- [ ] **Step 1: Create `content/game.json`**

```json
{
  "critRate": 0.12,
  "critMultiplier": 1.6,
  "mpRegen": 4,
  "stunChance": 0.3,
  "slowChance": 0.4,
  "weakenedMultiplier": 1.3,
  "defMultiplier": 0.5,
  "healRange": [28, 45]
}
```

End the file with a newline.

- [ ] **Step 2: Update `src/constants.js` to re-export**

Replace the inline `GAME` literal (lines 26–35) with a JSON import. The full replacement block is:

```js
import gameJson from "../content/game.json" with { type: "json" };

export const PIXEL_FONT = `"Press Start 2P", monospace`;

export const C = {
  bg: "#0a0e14", panel: "#111820", border: "#2a3a4a",
  bright: "#00ff88", dim: "#1a6644", red: "#ff4444",
  orange: "#ff8844", yellow: "#ffcc00", cyan: "#44ccff",
  white: "#e0e8f0", muted: "#556677",
  hpGreen: "#00cc66", hpRed: "#cc2222", mpBlue: "#3388ee",
};

export const STATUS = {
  STUNNED: "STUNNED",
  WEAKENED: "WEAKENED",
  DEF_PLUS: "DEF+",
  SLOWED: "SLOWED",
};

export const TIMINGS = {
  turnDelay: 1200,
  stunDelay: 800,
  shakeAnim: 400,
  flashAnim: 300,
  blinkInterval: 600,
};

export const GAME = gameJson;

export { rand, pick } from "./game/rng.js";
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all 237 tests pass. `GAME` values are identical (no numeric drift), so nothing should change.

Also run the sim to confirm no drift:

Run: `npm run sim`
Expected: `balance-report.json` written. Both matchups match baseline exactly (loop regression test would flag drift; this is belt-and-braces).

- [ ] **Step 4: Commit**

```bash
git add content/game.json src/constants.js
git commit -m "refactor: extract GAME to content/game.json for tuner access"
```

---

## Task 3: `convergence.js`

Pure functions, no I/O. Write tests first.

**Files:**
- Create: `src/tune/convergence.js`
- Create: `src/__tests__/tune-convergence.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/tune-convergence.test.js`:

```js
import { describe, it, expect } from "vitest";
import { isConverged, isImprovement, worst, distance } from "../tune/convergence.js";

// Helper to build a two-matchup report compactly.
const r = (eng1, eng2) => ({
  matchups: [
    { matchup: "random-vs-random", engineerWinRate: eng1, contractorWinRate: 1 - eng1 },
    { matchup: "random-vs-ai",     engineerWinRate: eng2, contractorWinRate: 1 - eng2 },
  ],
});

describe("distance / worst", () => {
  it("distance is |engineerWinRate - 0.5|", () => {
    expect(distance(r(0.86, 0.5).matchups[0])).toBeCloseTo(0.36);
    expect(distance(r(0.86, 0.5).matchups[1])).toBeCloseTo(0.0);
  });

  it("worst is max distance across matchups", () => {
    expect(worst(r(0.86, 0.55))).toBeCloseTo(0.36);
    expect(worst(r(0.55, 0.86))).toBeCloseTo(0.36);
    expect(worst(r(0.5, 0.5))).toBeCloseTo(0.0);
  });
});

describe("isConverged", () => {
  it("returns false for fewer than 3 reports", () => {
    expect(isConverged([])).toBe(false);
    expect(isConverged([r(0.5, 0.5)])).toBe(false);
    expect(isConverged([r(0.5, 0.5), r(0.5, 0.5)])).toBe(false);
  });

  it("returns true when last 3 reports have both matchups in [0.45, 0.55]", () => {
    const hist = [r(0.86, 0.72), r(0.50, 0.50), r(0.46, 0.55), r(0.54, 0.45)];
    expect(isConverged(hist)).toBe(true);
  });

  it("returns false if any of the last 3 has a matchup outside band", () => {
    const hist = [r(0.50, 0.50), r(0.50, 0.50), r(0.46, 0.56)];
    expect(isConverged(hist)).toBe(false);
  });

  it("ignores reports older than the last 3", () => {
    const hist = [r(0.90, 0.90), r(0.50, 0.50), r(0.50, 0.50), r(0.50, 0.50)];
    expect(isConverged(hist)).toBe(true);
  });
});

describe("isImprovement", () => {
  it("true when worst strictly decreases and no matchup regresses >2pp", () => {
    expect(isImprovement(r(0.86, 0.72), r(0.80, 0.72))).toBe(true);
  });

  it("false when worst does not strictly decrease", () => {
    expect(isImprovement(r(0.86, 0.72), r(0.86, 0.72))).toBe(false);
    expect(isImprovement(r(0.86, 0.72), r(0.86, 0.70))).toBe(false); // 86 is still worst
  });

  it("false when any matchup regresses by more than 2pp", () => {
    // worst drops (86->80), but matchup 2 regresses by 3pp
    expect(isImprovement(r(0.86, 0.72), r(0.80, 0.75))).toBe(false);
  });

  it("true when a matchup regresses by exactly 2pp (inclusive)", () => {
    expect(isImprovement(r(0.86, 0.72), r(0.80, 0.74))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/tune-convergence.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/tune/convergence.js`**

```js
// Pure convergence/improvement math for the tuning loop.
// No I/O. All inputs are two-matchup reports: { matchups: [BalanceReport, BalanceReport] }.

const BAND_LOW = 0.45;
const BAND_HIGH = 0.55;
const CROSS_MATCHUP_TOLERANCE = 0.02; // 2pp
const EPSILON = 1e-9;                 // tolerate floating-point noise in comparisons

export function distance(matchup) {
  return Math.abs(matchup.engineerWinRate - 0.5);
}

export function worst(report) {
  return Math.max(...report.matchups.map(distance));
}

export function isConverged(history) {
  if (history.length < 3) return false;
  const lastThree = history.slice(-3);
  return lastThree.every((report) =>
    report.matchups.every(
      (m) => m.engineerWinRate >= BAND_LOW && m.engineerWinRate <= BAND_HIGH,
    ),
  );
}

export function isImprovement(prev, curr) {
  if (worst(curr) >= worst(prev) - EPSILON) return false;
  // No matchup may regress by more than CROSS_MATCHUP_TOLERANCE.
  for (let i = 0; i < prev.matchups.length; i++) {
    const regression = distance(curr.matchups[i]) - distance(prev.matchups[i]);
    if (regression > CROSS_MATCHUP_TOLERANCE + EPSILON) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/tune-convergence.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tune/convergence.js src/__tests__/tune-convergence.test.js
git commit -m "feat(tune): convergence module (isConverged, isImprovement, worst)"
```

---

## Task 4: `applyProposal.js`

Reads/writes/reverts a `Proposal` against `content/game.json` and `content/moves/*.json`.

**Files:**
- Create: `src/tune/applyProposal.js`
- Create: `src/__tests__/tune-applyProposal.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/tune-applyProposal.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, writeProposal, revertProposal } from "../tune/applyProposal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const gameJsonPath = path.join(repoRoot, "content/game.json");
const engMovesPath = path.join(repoRoot, "content/moves/engineer.json");

let originalGame;
let originalEngMoves;

beforeEach(() => {
  originalGame = fs.readFileSync(gameJsonPath, "utf-8");
  originalEngMoves = fs.readFileSync(engMovesPath, "utf-8");
});

afterEach(() => {
  fs.writeFileSync(gameJsonPath, originalGame);
  fs.writeFileSync(engMovesPath, originalEngMoves);
});

describe("readConfig", () => {
  it("returns the current GAME and moves for both sides", () => {
    const cfg = readConfig();
    expect(cfg.GAME).toEqual(expect.objectContaining({
      critRate: expect.any(Number),
      critMultiplier: expect.any(Number),
      mpRegen: expect.any(Number),
    }));
    expect(cfg.moves.engineer).toBeInstanceOf(Array);
    expect(cfg.moves.engineer[0]).toHaveProperty("name");
    expect(cfg.moves.contractor).toBeInstanceOf(Array);
  });
});

describe("writeProposal / revertProposal — GAME scalar", () => {
  it("writes a GAME scalar change, then reverts it exactly", () => {
    const before = readConfig().GAME.critMultiplier;
    const proposal = {
      rule: "test",
      target: "GAME.critMultiplier",
      before,
      after: before - 0.05,
      summary: "test",
    };
    writeProposal(proposal);
    expect(readConfig().GAME.critMultiplier).toBeCloseTo(before - 0.05);

    revertProposal(proposal);
    expect(readConfig().GAME.critMultiplier).toBeCloseTo(before);
  });
});

describe("writeProposal / revertProposal — GAME tuple", () => {
  it("writes an array-valued GAME field, then reverts", () => {
    const before = readConfig().GAME.healRange;
    const after = [before[0] + 2, before[1]];
    const proposal = {
      rule: "test",
      target: "GAME.healRange",
      before,
      after,
      summary: "test",
    };
    writeProposal(proposal);
    expect(readConfig().GAME.healRange).toEqual(after);

    revertProposal(proposal);
    expect(readConfig().GAME.healRange).toEqual(before);
  });
});

describe("writeProposal / revertProposal — move field", () => {
  it("writes a move dmg change, then reverts", () => {
    const cfg = readConfig();
    const original = cfg.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    const before = original.dmg;
    const after = [before[0] - 1, before[1] - 1];
    const proposal = {
      rule: "test",
      target: "engineer.REJECT SUBMITTAL.dmg",
      before,
      after,
      summary: "test",
    };
    writeProposal(proposal);
    const afterCfg = readConfig();
    const mutated = afterCfg.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(mutated.dmg).toEqual(after);

    revertProposal(proposal);
    const restored = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(restored.dmg).toEqual(before);
  });

  it("writes a move mp change (scalar), then reverts", () => {
    const proposal = {
      rule: "test",
      target: "engineer.REJECT SUBMITTAL.mp",
      before: 0,
      after: 1,
      summary: "test",
    };
    writeProposal(proposal);
    const mutated = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(mutated.mp).toBe(1);

    revertProposal(proposal);
    const restored = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(restored.mp).toBe(0);
  });
});

describe("writeProposal — error paths", () => {
  it("throws on an unknown GAME key", () => {
    const proposal = {
      rule: "test", target: "GAME.bogusKey", before: 1, after: 2, summary: "test",
    };
    expect(() => writeProposal(proposal)).toThrow(/GAME\.bogusKey/);
  });

  it("throws on an unknown move name", () => {
    const proposal = {
      rule: "test", target: "engineer.NOPE.dmg", before: [1, 2], after: [2, 3], summary: "test",
    };
    expect(() => writeProposal(proposal)).toThrow(/NOPE/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/tune-applyProposal.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/tune/applyProposal.js`**

```js
// Reads, writes, and reverts a Proposal against content/game.json and content/moves/*.json.
// No React, no game logic — just filesystem I/O + small path parsing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const gameJsonPath = path.join(repoRoot, "content/game.json");
const movesPath = {
  engineer: path.join(repoRoot, "content/moves/engineer.json"),
  contractor: path.join(repoRoot, "content/moves/contractor.json"),
};

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeJson(p, obj) {
  // Match existing content formatting: 2-space indent, trailing newline.
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

export function readConfig() {
  return {
    GAME: readJson(gameJsonPath),
    moves: {
      engineer: readJson(movesPath.engineer),
      contractor: readJson(movesPath.contractor),
    },
  };
}

// Parse a proposal target into an operation plan.
// Returns { kind: "game", key } or { kind: "move", side, moveName, field }.
function parseTarget(target) {
  if (target.startsWith("GAME.")) {
    return { kind: "game", key: target.slice("GAME.".length) };
  }
  // "<side>.<moveName>.<field>" — moveName may contain spaces (e.g. "REJECT SUBMITTAL").
  // Split on first and last dot.
  const firstDot = target.indexOf(".");
  const lastDot = target.lastIndexOf(".");
  if (firstDot === -1 || firstDot === lastDot) {
    throw new Error(`applyProposal: cannot parse target '${target}'`);
  }
  const side = target.slice(0, firstDot);
  const field = target.slice(lastDot + 1);
  const moveName = target.slice(firstDot + 1, lastDot);
  if (side !== "engineer" && side !== "contractor") {
    throw new Error(`applyProposal: unknown side '${side}' in target '${target}'`);
  }
  return { kind: "move", side, moveName, field };
}

function applyValue(proposal, value) {
  const plan = parseTarget(proposal.target);
  if (plan.kind === "game") {
    const game = readJson(gameJsonPath);
    if (!(plan.key in game)) {
      throw new Error(`applyProposal: unknown GAME.${plan.key}`);
    }
    game[plan.key] = value;
    writeJson(gameJsonPath, game);
    return;
  }
  const p = movesPath[plan.side];
  const moves = readJson(p);
  const idx = moves.findIndex((m) => m.name === plan.moveName);
  if (idx === -1) {
    throw new Error(`applyProposal: no move named '${plan.moveName}' in ${plan.side}.json`);
  }
  if (!(plan.field in moves[idx])) {
    throw new Error(`applyProposal: move '${plan.moveName}' has no field '${plan.field}'`);
  }
  moves[idx][plan.field] = value;
  writeJson(p, moves);
}

export function writeProposal(proposal) {
  applyValue(proposal, proposal.after);
}

export function revertProposal(proposal) {
  applyValue(proposal, proposal.before);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/tune-applyProposal.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Run full suite to confirm nothing regressed**

Run: `npm test`
Expected: all tests pass (236 existing + new tune-convergence + new tune-applyProposal tests).

- [ ] **Step 6: Commit**

```bash
git add src/tune/applyProposal.js src/__tests__/tune-applyProposal.test.js
git commit -m "feat(tune): applyProposal read/write/revert module"
```

---

## Task 5: `proposer.js` — round-robin rule library

6 rules, each pure. Round-robin selection based on iteration number. Each rule returns null when it cannot produce a valid (bounded) proposal.

**Files:**
- Create: `src/tune/proposer.js`
- Create: `src/__tests__/tune-proposer.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/tune-proposer.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { propose, RULES } from "../tune/proposer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const gameJsonPath = path.join(repoRoot, "content/game.json");
const engMovesPath = path.join(repoRoot, "content/moves/engineer.json");
const conMovesPath = path.join(repoRoot, "content/moves/contractor.json");

let origGame, origEng, origCon;

beforeEach(() => {
  origGame = fs.readFileSync(gameJsonPath, "utf-8");
  origEng = fs.readFileSync(engMovesPath, "utf-8");
  origCon = fs.readFileSync(conMovesPath, "utf-8");
});

afterEach(() => {
  fs.writeFileSync(gameJsonPath, origGame);
  fs.writeFileSync(engMovesPath, origEng);
  fs.writeFileSync(conMovesPath, origCon);
});

// Helper that mimics the balance-baseline.json shape.
const dominantEngineerReport = {
  matchups: [
    {
      matchup: "random-vs-random",
      engineerWinRate: 0.865,
      contractorWinRate: 0.135,
      drawRate: 0,
      avgTurns: 12.46,
      moveFrequency: {
        engineer: {
          "REJECT SUBMITTAL": 0.32, "CITE UFC": 0.15, "INVOKE SHALL": 0.13,
          "RED-LINE SPEC": 0.15, "CURE NOTICE": 0.12, "ISSUE NCR": 0.13,
        },
        contractor: {
          "SCHEDULE DELAY": 0.16, "SUBMIT RFI": 0.20, "RESERVE RIGHTS": 0.18,
          "CLAIM DSC": 0.15, "VALUE ENGINEER": 0.15, "OR-EQUAL GAMBIT": 0.16,
        },
      },
    },
    {
      matchup: "random-vs-ai",
      engineerWinRate: 0.72,
      contractorWinRate: 0.28,
      drawRate: 0,
      avgTurns: 18.7,
      moveFrequency: {
        engineer: {
          "REJECT SUBMITTAL": 0.40, "CITE UFC": 0.15, "INVOKE SHALL": 0.10,
          "RED-LINE SPEC": 0.12, "CURE NOTICE": 0.09, "ISSUE NCR": 0.14,
        },
        contractor: {
          "SUBMIT RFI": 0.21, "RESERVE RIGHTS": 0.26, "VALUE ENGINEER": 0.27,
          "OR-EQUAL GAMBIT": 0.09, "CLAIM DSC": 0.08, "SCHEDULE DELAY": 0.10,
        },
      },
    },
  ],
};

describe("RULES library", () => {
  it("exposes 6 named rules in priority order", () => {
    expect(RULES).toHaveLength(6);
    expect(RULES.map((r) => r.name)).toEqual([
      "nerf-top-usage-move",
      "buff-weak-side-top-move",
      "lower-crit-multiplier",
      "trim-mp-regen",
      "tame-weaken",
      "raise-heal-floor",
    ]);
  });
});

describe("propose (round-robin)", () => {
  it("returns a Proposal object for iteration 0 with dominant-engineer baseline", () => {
    const p = propose(dominantEngineerReport, 0);
    expect(p).not.toBeNull();
    expect(p).toEqual(expect.objectContaining({
      rule: expect.any(String),
      target: expect.any(String),
      before: expect.anything(),
      after: expect.anything(),
      summary: expect.any(String),
    }));
  });

  it("iteration 0 picks rule 'nerf-top-usage-move' (engineer dominant → REJECT SUBMITTAL is top)", () => {
    const p = propose(dominantEngineerReport, 0);
    expect(p.rule).toBe("nerf-top-usage-move");
    // REJECT SUBMITTAL is the top-used engineer move (32% / 40%).
    expect(p.target).toBe("engineer.REJECT SUBMITTAL.dmg");
    expect(p.before).toEqual([16, 24]);
    expect(p.after).toEqual([15, 23]);
  });

  it("iteration 2 falls through lower-crit-multiplier (mean turns > 14), lands on trim-mp-regen", () => {
    // Rule 2 (lower-crit-multiplier) fires only when mean avgTurns < 14.
    // Fixture: (12.46 + 18.7) / 2 = 15.58 → rule 2 declines.
    // Round-robin advances to rule 3 (trim-mp-regen). Conditions:
    //   engineer winrate avg = (0.865 + 0.72) / 2 = 0.79 ≥ 0.6 ✓
    //   engineer top-2 MP moves: CURE NOTICE (28) + INVOKE SHALL (20), avg 24 > 10 ✓
    // So rule 3 fires.
    const p = propose(dominantEngineerReport, 2);
    expect(p.rule).toBe("trim-mp-regen");
    expect(p.target).toBe("GAME.mpRegen");
    expect(p.before).toBe(4);
    expect(p.after).toBe(3);
  });

  it("returns null if all rules decline (balanced report)", () => {
    const balanced = {
      matchups: [
        {
          matchup: "random-vs-random",
          engineerWinRate: 0.5, contractorWinRate: 0.5, drawRate: 0, avgTurns: 20,
          moveFrequency: { engineer: {}, contractor: {} },
        },
        {
          matchup: "random-vs-ai",
          engineerWinRate: 0.5, contractorWinRate: 0.5, drawRate: 0, avgTurns: 20,
          moveFrequency: { engineer: {}, contractor: {} },
        },
      ],
    };
    expect(propose(balanced, 0)).toBeNull();
    expect(propose(balanced, 5)).toBeNull();
  });

  it("round-robin starts from iteration index modulo RULES.length", () => {
    // Iteration 6 should try the same rule as iteration 0.
    const p0 = propose(dominantEngineerReport, 0);
    const p6 = propose(dominantEngineerReport, 6);
    expect(p6.rule).toBe(p0.rule);
  });

  it("is deterministic given the same report and iteration", () => {
    const a = propose(dominantEngineerReport, 0);
    const b = propose(dominantEngineerReport, 0);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/tune-proposer.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/tune/proposer.js`**

```js
// Round-robin heuristic proposer for Phase 2.1.
// Each rule: pure function of (report, config) → Proposal | null.
// propose(report, iteration): tries rules[iteration % N], falls through on null.

import { readConfig } from "./applyProposal.js";

// ---- helpers ----

const distance = (m) => Math.abs(m.engineerWinRate - 0.5);
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

function dominantSide(report) {
  // Side whose max deviation across matchups is largest.
  // engineerWinRate > 0.5 means engineer is winning.
  const engWorst = Math.max(...report.matchups.map((m) => m.engineerWinRate - 0.5));
  const conWorst = Math.max(...report.matchups.map((m) => 0.5 - m.engineerWinRate));
  if (engWorst > conWorst) return "engineer";
  if (conWorst > engWorst) return "contractor";
  return null;
}

function topUsageMove(report, side) {
  // Aggregate usage across matchups (sum of frequencies).
  const totals = {};
  for (const m of report.matchups) {
    const freq = m.moveFrequency[side] || {};
    for (const [name, f] of Object.entries(freq)) {
      totals[name] = (totals[name] || 0) + f;
    }
  }
  let best = null;
  let bestF = -Infinity;
  for (const [name, f] of Object.entries(totals)) {
    if (f > bestF) { best = name; bestF = f; }
  }
  return best;
}

function topCostMove(side, cfg) {
  // Move with highest mp cost from live config.
  const moves = cfg.moves[side];
  return [...moves].sort((a, b) => b.mp - a.mp)[0];
}

function topTwoCostAvg(side, cfg) {
  const moves = [...cfg.moves[side]].sort((a, b) => b.mp - a.mp);
  if (moves.length < 2) return moves[0]?.mp ?? 0;
  return (moves[0].mp + moves[1].mp) / 2;
}

// ---- rules ----
// Each rule: (report, config) => Proposal | null

function ruleNerfTopUsage(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  // Dominant side must actually be winning (engineerWinRate deviation > 0).
  const engAvg = avg(report.matchups.map((m) => m.engineerWinRate));
  if (dom === "engineer" && engAvg <= 0.5) return null;
  if (dom === "contractor" && engAvg >= 0.5) return null;

  const moveName = topUsageMove(report, dom);
  if (!moveName) return null;
  const move = cfg.moves[dom].find((m) => m.name === moveName);
  if (!move) return null;

  const [lo, hi] = move.dmg;
  // Nerf dmg range by 1 if it keeps hi >= lo and lo >= 1.
  if (hi - 1 >= lo && lo - 1 >= 1) {
    const after = [lo - 1, hi - 1];
    return {
      rule: "nerf-top-usage-move",
      target: `${dom}.${moveName}.dmg`,
      before: [lo, hi],
      after,
      summary: `Nerf ${dom} ${moveName} dmg ${JSON.stringify([lo, hi])} -> ${JSON.stringify(after)}`,
    };
  }
  // Else raise MP (cap 30).
  if (move.mp + 1 <= 30) {
    return {
      rule: "nerf-top-usage-move",
      target: `${dom}.${moveName}.mp`,
      before: move.mp,
      after: move.mp + 1,
      summary: `Raise ${dom} ${moveName} mp ${move.mp} -> ${move.mp + 1}`,
    };
  }
  return null;
}

function ruleBuffWeakTop(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  const weak = dom === "engineer" ? "contractor" : "engineer";
  const move = topCostMove(weak, cfg);
  if (!move) return null;
  const [lo, hi] = move.dmg;
  if (hi + 1 > 60) return null; // rough upper bound
  const after = [lo + 1, hi + 1];
  return {
    rule: "buff-weak-side-top-move",
    target: `${weak}.${move.name}.dmg`,
    before: [lo, hi],
    after,
    summary: `Buff ${weak} ${move.name} dmg ${JSON.stringify([lo, hi])} -> ${JSON.stringify(after)}`,
  };
}

function ruleLowerCrit(report, cfg) {
  const meanTurns = avg(report.matchups.map((m) => m.avgTurns));
  if (meanTurns >= 14) return null;
  const before = cfg.GAME.critMultiplier;
  const after = +(before - 0.05).toFixed(2);
  if (after < 1.1) return null;
  return {
    rule: "lower-crit-multiplier",
    target: "GAME.critMultiplier",
    before, after,
    summary: `Lower GAME.critMultiplier ${before} -> ${after}`,
  };
}

function ruleTrimMpRegen(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  const engAvg = avg(report.matchups.map((m) => m.engineerWinRate));
  const winRate = dom === "engineer" ? engAvg : 1 - engAvg;
  if (winRate < 0.6) return null;
  if (topTwoCostAvg(dom, cfg) <= 10) return null;
  const before = cfg.GAME.mpRegen;
  const after = before - 1;
  if (after < 2) return null;
  return {
    rule: "trim-mp-regen",
    target: "GAME.mpRegen",
    before, after,
    summary: `Trim GAME.mpRegen ${before} -> ${after}`,
  };
}

function ruleTameWeaken(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  const engAvg = avg(report.matchups.map((m) => m.engineerWinRate));
  const winRate = dom === "engineer" ? engAvg : 1 - engAvg;
  if (winRate < 0.6) return null;
  const before = cfg.GAME.weakenedMultiplier;
  const after = +(before - 0.05).toFixed(2);
  if (after < 1.05) return null;
  return {
    rule: "tame-weaken",
    target: "GAME.weakenedMultiplier",
    before, after,
    summary: `Tame GAME.weakenedMultiplier ${before} -> ${after}`,
  };
}

function ruleRaiseHealFloor(report, cfg) {
  const dom = dominantSide(report);
  if (dom !== "engineer") return null; // only fires when contractor is losing
  const [lo, hi] = cfg.GAME.healRange;
  const after = [lo + 2, hi];
  if (after[0] > 45 || after[0] > hi) return null;
  return {
    rule: "raise-heal-floor",
    target: "GAME.healRange",
    before: [lo, hi],
    after,
    summary: `Raise GAME.healRange ${JSON.stringify([lo, hi])} -> ${JSON.stringify(after)}`,
  };
}

export const RULES = [
  { name: "nerf-top-usage-move",    fn: ruleNerfTopUsage },
  { name: "buff-weak-side-top-move", fn: ruleBuffWeakTop },
  { name: "lower-crit-multiplier",  fn: ruleLowerCrit },
  { name: "trim-mp-regen",          fn: ruleTrimMpRegen },
  { name: "tame-weaken",            fn: ruleTameWeaken },
  { name: "raise-heal-floor",       fn: ruleRaiseHealFloor },
];

export function propose(report, iteration) {
  const cfg = readConfig();
  const n = RULES.length;
  for (let offset = 0; offset < n; offset++) {
    const rule = RULES[(iteration + offset) % n];
    const p = rule.fn(report, cfg);
    if (p) return p;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/tune-proposer.test.js`
Expected: PASS (7 tests).

If any rule fixture expectations don't line up exactly, re-read the report fixture + rule logic carefully before adjusting either side. The fixture matches `balance-baseline.json`, so expectations must be consistent with the rule semantics above.

- [ ] **Step 5: Commit**

```bash
git add src/tune/proposer.js src/__tests__/tune-proposer.test.js
git commit -m "feat(tune): round-robin proposer with 6-rule heuristic library"
```

---

## Task 6: `gitOps.js`

Thin wrapper. Injectable `exec` so tests don't shell out.

**Files:**
- Create: `src/tune/gitOps.js`
- Create: `src/__tests__/tune-gitOps.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/tune-gitOps.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { makeGit } from "../tune/gitOps.js";

describe("makeGit", () => {
  it("commitAll runs 'git add -A' then 'git commit -m <msg>' via injected exec", () => {
    const calls = [];
    const exec = vi.fn((cmd) => { calls.push(cmd); return ""; });
    const git = makeGit({ exec });

    git.commitAll("tune(iter-1): nerf REJECT SUBMITTAL dmg");

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("git add -A");
    expect(calls[1]).toMatch(/^git commit -m /);
    expect(calls[1]).toContain("tune(iter-1): nerf REJECT SUBMITTAL dmg");
  });

  it("escapes double quotes inside the commit message", () => {
    const calls = [];
    const exec = vi.fn((cmd) => { calls.push(cmd); return ""; });
    const git = makeGit({ exec });

    git.commitAll(`tune: change "X" to "Y"`);

    expect(calls[1]).toContain(`\\"X\\"`);
    expect(calls[1]).toContain(`\\"Y\\"`);
  });

  it("propagates exec errors", () => {
    const exec = () => { throw new Error("git: command not found"); };
    const git = makeGit({ exec });
    expect(() => git.commitAll("whatever")).toThrow(/git: command not found/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/tune-gitOps.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/tune/gitOps.js`**

```js
// Tiny wrapper over `git add`/`git commit` with an injectable exec so tests
// don't shell out. The production factory uses execSync; tests substitute a fake.

import { execSync } from "node:child_process";

const defaultExec = (cmd) => execSync(cmd, { encoding: "utf-8" });

export function makeGit({ exec = defaultExec } = {}) {
  return {
    commitAll(message) {
      exec("git add -A");
      const escaped = message.replace(/"/g, '\\"');
      exec(`git commit -m "${escaped}"`);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/tune-gitOps.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tune/gitOps.js src/__tests__/tune-gitOps.test.js
git commit -m "feat(tune): gitOps commitAll wrapper with injectable exec"
```

---

## Task 7: `loop.js` — main loop + kill-switch

The biggest module. Everything is injectable so the test can drive 50 iterations in milliseconds.

**Files:**
- Create: `src/tune/loop.js`
- Create: `src/__tests__/tune-loop.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/tune-loop.test.js`:

```js
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
  // Use the real convergence by importing it; but for unit isolation, mock the shape.
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
      // Proposer always produces a trivial proposal; apply is a no-op.
      proposer: { propose: () => ({ rule: "x", target: "GAME.mpRegen", before: 4, after: 3, summary: "test" }) },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 2, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("budget-iters");
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
      proposer: { propose: () => ({ rule: "x", target: "GAME.mpRegen", before: 4, after: 3, summary: "test" }) },
      apply: { write: () => {}, revert: () => {} },
      convergence: makeFakeConvergence(),
      maxIterations: 50, maxWallMs: 1e9, abortFile: ".abort",
      summaryFile: "summary.md", nextBaselineFile: "next.json",
      dryRun: false, log: () => {},
    });
    expect(result.reason).toBe("converged");
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
      proposer: { propose: (_, i) => i === 0 ? ({ rule: "x", target: "GAME.mpRegen", before: 4, after: 3, summary: "t" }) : null },
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
      proposer: { propose: () => ({ rule: "x", target: "GAME.mpRegen", before: 4, after: 3, summary: "t" }) },
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
      proposer: { propose: () => ({ rule: "noop", target: "GAME.mpRegen", before: 4, after: 4, summary: "noop" }) },
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/tune-loop.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/tune/loop.js`**

```js
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
  let iterLimit = dryRun ? Math.min(2, maxIterations) : maxIterations;

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
    if (iter >= iterLimit) return finalize("budget-iters");
    if (convergence.isConverged(history.map((h) => h.report))) return finalize("converged");

    const proposal = proposer.propose(current, iter);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/tune-loop.test.js`
Expected: PASS (7 tests including the kill-switch test).

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tune/loop.js src/__tests__/tune-loop.test.js
git commit -m "feat(tune): tuning loop orchestrator with kill-switch test"
```

---

## Task 8: CLI + `package.json` scripts

Wire the real sim, real tests, real fs, real git.

**Files:**
- Create: `scripts/tune.js`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/tune.js`**

```js
#!/usr/bin/env node
// CLI for the heuristic tuning loop.
//
// Usage:
//   node scripts/tune.js                         # full run with defaults
//   node scripts/tune.js --dry-run               # 2-iteration smoke, no writes, no commits
//   node scripts/tune.js --max-iters=20          # cap iterations
//   node scripts/tune.js --max-wall-ms=300000    # cap wall-clock

import { execSync } from "node:child_process";
import fs from "node:fs";
import { runBatch } from "../src/sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../src/sim/policies.js";
import { runLoop } from "../src/tune/loop.js";
import { propose } from "../src/tune/proposer.js";
import { writeProposal, revertProposal } from "../src/tune/applyProposal.js";
import { isConverged, isImprovement } from "../src/tune/convergence.js";
import { makeGit } from "../src/tune/gitOps.js";

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
const maxIterations = flag("max-iters", 50);
const maxWallMs = flag("max-wall-ms", 15 * 60 * 1000);

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
  proposer: { propose },
  apply: { write: writeProposal, revert: revertProposal },
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

- [ ] **Step 2: Update `package.json`**

Add two scripts. The final `"scripts"` block is:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "sim": "node scripts/simulate.js",
    "sim:update-baseline": "node scripts/simulate.js --update-baseline",
    "tune": "node scripts/tune.js",
    "tune:dry-run": "node scripts/tune.js --dry-run"
  },
```

- [ ] **Step 3: Smoke the dry-run**

Run: `npm run tune:dry-run`
Expected:
- Prints `[tune] iter 1: ...` (one proposal line)
- Prints `[tune] stopped: budget-iters`
- Exits 0
- No new files in git status (no `tuning-summary.md`, no `balance-baseline.next.json`, no new commits)

Verify with: `git status --short` — should still be clean (only modified `package.json`, which was the intentional change in Step 2).

- [ ] **Step 4: Commit**

```bash
git add scripts/tune.js package.json
git commit -m "feat(tune): CLI entry (tune + tune:dry-run) with signal handlers"
```

---

## Task 9: End-to-end smoke run

Non-TDD — this task runs the real loop briefly to prove it functions in anger. No code changes; output is a commit if the loop accepts a real improvement, otherwise a clean branch.

- [ ] **Step 1: Run the real tuner with a small iteration cap**

Run: `npm run tune -- --max-iters=5`

Expected behavior:
- Baseline sim prints engineer win rate around 86.5% / 71.5%.
- Loop tries up to 5 proposals. Each accepted proposal produces a `tune(iter-N): ...` commit.
- On exit: prints `[tune] stopped: budget-iters` (or `exhausted` if all 5 rules decline, which is unlikely given the current imbalance).
- `tuning-summary.md` and `balance-baseline.next.json` exist at repo root (both gitignored).
- `git log --oneline -10` shows 0 or more new `tune(iter-*)` commits, depending on acceptance.

- [ ] **Step 2: Inspect outputs**

Read: `tuning-summary.md` — verify the table has one row per iteration + accepted column filled.
Read: `balance-baseline.next.json` — verify it's a valid two-matchup report.

- [ ] **Step 3: Reset the branch state**

If the smoke run produced `tune(iter-*)` commits and you don't want them on the final PR, roll them back:

```bash
# Count the tune commits and roll back that many. Inspect first:
git log --oneline | head -10
# If you see e.g. 3 tune(iter-*) commits, roll them back:
# git reset --hard HEAD~3
```

**Note:** `git reset --hard` is destructive. Only run it if you're certain the commits are smoke-run artifacts you don't want to keep. If in doubt, keep them — they show the loop works.

Also clean up the artifact files:

```bash
rm -f tuning-summary.md balance-baseline.next.json .tuning-abort
```

- [ ] **Step 4: (Optional) Record a note in the summary if the ceiling is visible**

If the 5-iteration run shows the proposer getting stuck (same proposal reverted repeatedly) or plateauing well above the target band, that's useful 2.2 signal. Consider appending a short paragraph to `ROADMAP.md` under Phase 2.2's "Parked questions" noting which rules hit their ceiling.

This step is optional — skip if the run was too short to draw conclusions. The full 50-iteration run is the first thing Phase 2.1 does after merging to master.

- [ ] **Step 5: No commit for this task unless Step 4 produced one**

Task 9 is verification, not new code. If you added a note to ROADMAP.md in Step 4:

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): Phase 2.2 note on observed heuristic ceiling"
```

Otherwise no commit.

---

## Self-review (inline, for the plan author)

Spec coverage check against ROADMAP.md Phase 2.1:
- ✅ `npm run tune` end-to-end — Tasks 7, 8
- ✅ `npm run tune:dry-run` — Task 8
- ✅ Automated kill-switch test — Task 7 ("KILL SWITCH" test)
- ✅ `SKIP_BALANCE_REGRESSION=1` honored — Task 1
- ✅ `.tuning-abort` gitignored — Task 1
- ✅ `tuning-summary.md`, `balance-baseline.next.json` written on exit — Task 7
- ✅ Loop never writes `balance-baseline.json` — enforced by not passing that path to the loop
- ✅ Convergence: [45,55] / 3 consec / 2pp guard — Task 3
- ✅ Budget: 50 iter / 15 min — Task 7 defaults + Task 8 flags
- ✅ Search space: GAME + per-move numeric stats — Tasks 4, 5
- ✅ SIGINT/SIGTERM → graceful stop — Task 8 signal handlers

No placeholders. Types consistent: `Proposal` shape defined once (Design Contracts), referenced in Tasks 4/5/7. Method signatures consistent: `runLoop`, `runSim`, `runTests`, `propose`, `write`/`revert`.
