# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic, seeded simulation of spec-battle with a recorded balance baseline and regression tests that fail on drift.

**Architecture:** Add a seedable RNG module (`src/game/rng.js`) that defaults to `Math.random()` for production and switches to xorshift32 when seeded, preserving existing test spies. Build a `src/sim/` harness that drives the existing reducer with policy-chosen moves, aggregates results, and compares to a committed baseline.

**Tech Stack:** JavaScript (ES modules), Vite, Vitest. No new dependencies.

---

## File Structure

**New files:**
- `src/game/rng.js` — seedable RNG, single responsibility (random number generation)
- `src/__tests__/rng.test.js`
- `src/sim/policies.js` — move-selection policies for sim players
- `src/__tests__/sim-policies.test.js`
- `src/sim/runGame.js` — drives reducer for one game with two policies
- `src/__tests__/sim-runGame.test.js`
- `src/sim/runBatch.js` — runs N games, aggregates into BalanceReport
- `src/__tests__/sim-runBatch.test.js`
- `scripts/simulate.js` — CLI entry point
- `src/__tests__/balance-regression.test.js`
- `balance-baseline.json` (repo root, committed)

**Modified files:**
- `src/constants.js` — replace inline `rand`/`pick` with re-exports from `rng.js`
- `src/game/logic.js` — replace direct `Math.random()` calls with `random()` from `rng.js`
- `src/game/reducer.js` — `ENEMY_MOVE` accepts `action.move` as optional override
- `src/__tests__/reducer.test.js` — add coverage for override path
- `package.json` — add `sim` and `sim:update-baseline` scripts
- `.gitignore` — ignore `balance-report.json`

Files in `src/sim/` and `src/game/rng.js` are kept small and single-purpose. The sim module does not reach into component code (no React).

---

## Design Contracts

Referenced by multiple tasks — read before starting.

### `src/game/rng.js`

- `seed(n: number | null) → void` — switches the module into deterministic mode when `n` is a nonzero integer; resets to `Math.random()` fallback when `n` is `null`.
- `random() → number` — returns a value in `[0, 1)`. When unseeded, delegates to `Math.random()`. When seeded, advances xorshift32 state and returns `(state >>> 0) / 0x100000000`.
- `rand(a, b) → number` — integer in `[a, b]`, inclusive.
- `pick(arr) → T` — uniform pick from non-empty array.

Defaulting to `Math.random()` is intentional: existing tests use `vi.spyOn(Math, "random")` and must keep working. Sim code explicitly calls `seed(n)` before each game.

### Policy signature

```js
policy(state, side) → move
```

- `state`: reducer state
- `side`: `"engineer"` or `"contractor"`
- Returns one of that side's moves from `character.moves`. MUST be affordable (`move.mp <= currentMp`) or the reducer will log "Not enough MP!" and stall.

### BalanceReport (returned by `runBatch`, serialized to JSON)

```js
{
  matchup: string,              // e.g. "random-vs-ai"
  startSeed: number,            // seed of the first game in the batch
  count: number,                // number of games run
  engineerWinRate: number,      // 0..1, rounded to 4 decimals
  contractorWinRate: number,    // 0..1
  drawRate: number,             // 0..1, for games that hit maxTurns
  avgTurns: number,             // rounded to 2 decimals
  moveFrequency: {              // per side, name → fraction of that side's moves
    engineer: { [moveName]: number },
    contractor: { [moveName]: number }
  }
}
```

### Top-level sim-run output (what `scripts/simulate.js` writes)

```js
{
  matchups: [BalanceReport, ...]
}
```

No `generatedAt` timestamp — git commit time serves that purpose; including it would create noisy baseline diffs.

---

## Task 1: Seedable RNG module

**Files:**
- Create: `src/game/rng.js`
- Test: `src/__tests__/rng.test.js`

- [ ] **Step 1: Write the failing tests**

Write `src/__tests__/rng.test.js`:

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { seed, random, rand, pick } from "../game/rng.js";

afterEach(() => {
  seed(null);
  vi.restoreAllMocks();
});

describe("rng", () => {
  it("delegates to Math.random when unseeded", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    expect(random()).toBe(0.42);
  });

  it("produces deterministic sequences from a seed", () => {
    seed(12345);
    const a = [random(), random(), random()];
    seed(12345);
    const b = [random(), random(), random()];
    expect(a).toEqual(b);
  });

  it("different seeds produce different sequences", () => {
    seed(1);
    const a = random();
    seed(2);
    const b = random();
    expect(a).not.toBe(b);
  });

  it("seeded values are in [0, 1)", () => {
    seed(999);
    for (let i = 0; i < 1000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("rand returns integers in [a, b] inclusive", () => {
    seed(7);
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(rand(1, 3));
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it("pick returns an element from the array", () => {
    seed(7);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(pick(arr));
    }
  });

  it("seed(null) restores Math.random fallback", () => {
    seed(42);
    random();
    seed(null);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(random()).toBe(0.99);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/rng.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/game/rng.js`**

```js
// Seedable RNG. Unseeded: delegates to Math.random() so existing vi.spyOn tests keep working.
// Seeded: deterministic xorshift32 for reproducible simulations.

let state = null; // null = use Math.random; otherwise holds xorshift32 state as int32

export function seed(n) {
  if (n == null) {
    state = null;
    return;
  }
  // xorshift32 cannot use 0 as state; nudge to 1 if the caller passes 0.
  const s = n | 0;
  state = s === 0 ? 1 : s;
}

export function random() {
  if (state === null) return Math.random();
  let s = state;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state = s | 0;
  return (state >>> 0) / 0x100000000;
}

export const rand = (a, b) => Math.floor(random() * (b - a + 1)) + a;

export const pick = (arr) => arr[Math.floor(random() * arr.length)];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/rng.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/rng.js src/__tests__/rng.test.js
git commit -m "feat(rng): add seedable RNG module with Math.random fallback"
```

---

## Task 2: Route existing code through `rng.js`

Replace direct `Math.random()` calls in `logic.js` and move `rand`/`pick` in `constants.js` to re-export from `rng.js`. Behavior is identical when unseeded, so all 208 existing tests must continue to pass.

**Files:**
- Modify: `src/game/logic.js:6,15,16`
- Modify: `src/constants.js:37-38`

- [ ] **Step 1: Update `src/constants.js` to re-export from rng**

Replace lines 37-38 (the inline `rand` and `pick` definitions) with:

```js
export { rand, pick } from "./game/rng.js";
```

Keep `clamp` as-is on line 39. Full replaced block at the bottom of the file:

```js
export { rand, pick } from "./game/rng.js";
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
```

- [ ] **Step 2: Update `src/game/logic.js` to import `random` from rng**

Change line 1 from:

```js
import { C, STATUS, GAME, rand, pick, clamp } from "../constants.js";
```

to:

```js
import { C, STATUS, GAME, clamp } from "../constants.js";
import { random, rand, pick } from "./rng.js";
```

Then replace `Math.random()` on line 6, 15, 16 with `random()`:

```js
// Line 6 (inside calculateDamage):
const crit = random() < GAME.critRate;

// Line 15 (inside rollStatusEffect):
if (move.effect === "stun" && random() < GAME.stunChance) return STATUS.STUNNED;

// Line 16:
if (move.effect === "slow" && random() < GAME.slowChance) return STATUS.SLOWED;
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: All 208 tests pass (plus the 7 rng tests from Task 1 = 215 total).

Existing tests use `vi.spyOn(Math, "random")`. Since `rng.js` delegates to `Math.random()` when unseeded, those spies still work. If any test fails, investigate before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/constants.js src/game/logic.js
git commit -m "refactor: route Math.random through rng.js module"
```

---

## Task 3: Extend `ENEMY_MOVE` to accept a pre-picked move

The reducer's `ENEMY_MOVE` currently always calls `pickAIMove(state)`. For simulations, we need the sim to supply its own move via a policy. Add `action.move` as an optional override; fall back to `pickAIMove` when absent.

**Files:**
- Modify: `src/game/reducer.js:63`
- Modify: `src/__tests__/reducer.test.js` (add test)

- [ ] **Step 1: Write the failing test**

Add this test to `src/__tests__/reducer.test.js` inside the existing `describe("Reducer", ...)` block (append before the closing of that describe):

```js
describe("ENEMY_MOVE with explicit move override", () => {
  it("uses action.move when provided instead of pickAIMove", () => {
    const s = { ...initState(), turn: "enemy", busy: true };
    const explicitMove = CONTRACTOR.moves[0]; // SUBMIT RFI
    const next = reducer(s, { type: "ENEMY_MOVE", move: explicitMove });
    // Move was used: contractor MP decreased by that move's cost (after regen)
    const expectedMp = Math.min(CONTRACTOR.maxMp, CONTRACTOR.maxMp - explicitMove.mp + CONTRACTOR.mpRegen);
    expect(next.conMp).toBe(expectedMp);
    expect(next.turn).toBe("player");
  });

  it("falls back to pickAIMove when action.move is absent", () => {
    const s = { ...initState(), turn: "enemy", busy: true };
    const next = reducer(s, { type: "ENEMY_MOVE" });
    // Should still advance — exact move not asserted (picked by pickAIMove)
    expect(next.turn).toBe("player");
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `npx vitest run src/__tests__/reducer.test.js`
Expected: the new "uses action.move when provided" test fails because `action.move` is ignored by current reducer code. The fallback test likely passes already.

- [ ] **Step 3: Implement the override**

In `src/game/reducer.js`, change line 63 from:

```js
const move = pickAIMove(state);
```

to:

```js
const move = action.move || pickAIMove(state);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/reducer.test.js`
Expected: all reducer tests pass including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/game/reducer.js src/__tests__/reducer.test.js
git commit -m "feat(reducer): allow ENEMY_MOVE to accept explicit move override"
```

---

## Task 4: Sim policies

**Files:**
- Create: `src/sim/policies.js`
- Test: `src/__tests__/sim-policies.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/sim-policies.test.js`:

```js
import { describe, it, expect, afterEach } from "vitest";
import { randomPolicy, aiPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { initState } from "../game/reducer.js";

afterEach(() => seed(null));

describe("randomPolicy", () => {
  it("returns an engineer move for side='engineer'", () => {
    seed(1);
    const move = randomPolicy(initState(), "engineer");
    expect(ENGINEER.moves).toContain(move);
  });

  it("returns a contractor move for side='contractor'", () => {
    seed(1);
    const move = randomPolicy(initState(), "contractor");
    expect(CONTRACTOR.moves).toContain(move);
  });

  it("only picks affordable moves", () => {
    seed(1);
    const s = { ...initState(), engMp: 5 };
    for (let i = 0; i < 100; i++) {
      const m = randomPolicy(s, "engineer");
      expect(m.mp).toBeLessThanOrEqual(5);
    }
  });

  it("is deterministic given a seed", () => {
    seed(42);
    const a = randomPolicy(initState(), "engineer");
    seed(42);
    const b = randomPolicy(initState(), "engineer");
    expect(a).toBe(b);
  });
});

describe("aiPolicy", () => {
  it("returns a contractor move", () => {
    const move = aiPolicy(initState(), "contractor");
    expect(CONTRACTOR.moves).toContain(move);
  });

  it("throws if called for engineer side", () => {
    expect(() => aiPolicy(initState(), "engineer")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/sim-policies.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/sim/policies.js`**

```js
import { pick } from "../game/rng.js";
import { pickAIMove } from "../game/logic.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";

export function randomPolicy(state, side) {
  const character = side === "engineer" ? ENGINEER : CONTRACTOR;
  const currentMp = side === "engineer" ? state.engMp : state.conMp;
  const affordable = character.moves.filter((m) => m.mp <= currentMp);
  // Every character has at least one 0-cost move, so `affordable` is never empty,
  // but fall back to moves[0] defensively.
  if (affordable.length === 0) return character.moves[0];
  return pick(affordable);
}

export function aiPolicy(state, side) {
  if (side !== "contractor") {
    throw new Error(`aiPolicy only supports side='contractor', got '${side}'`);
  }
  return pickAIMove(state);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/sim-policies.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/policies.js src/__tests__/sim-policies.test.js
git commit -m "feat(sim): add randomPolicy and aiPolicy for simulated play"
```

---

## Task 5: `runGame` — drive one game end-to-end

**Files:**
- Create: `src/sim/runGame.js`
- Test: `src/__tests__/sim-runGame.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/sim-runGame.test.js`:

```js
import { describe, it, expect, afterEach } from "vitest";
import { runGame } from "../sim/runGame.js";
import { randomPolicy, aiPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";

afterEach(() => seed(null));

describe("runGame", () => {
  it("runs to completion and returns a winner", () => {
    const result = runGame({
      seed: 1,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
    });
    expect(["engineer", "contractor", "draw"]).toContain(result.winner);
    expect(result.turns).toBeGreaterThan(0);
  });

  it("is deterministic given the same seed and policies", () => {
    const a = runGame({ seed: 7, engPolicy: randomPolicy, conPolicy: randomPolicy });
    const b = runGame({ seed: 7, engPolicy: randomPolicy, conPolicy: randomPolicy });
    expect(a).toEqual(b);
  });

  it("different seeds produce different games", () => {
    const a = runGame({ seed: 1, engPolicy: randomPolicy, conPolicy: randomPolicy });
    const b = runGame({ seed: 9999, engPolicy: randomPolicy, conPolicy: randomPolicy });
    // Extremely unlikely to be identical across two different seeds
    expect(a).not.toEqual(b);
  });

  it("records move frequency per side", () => {
    const result = runGame({
      seed: 1,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
    });
    expect(result.moveCount).toHaveProperty("engineer");
    expect(result.moveCount).toHaveProperty("contractor");
    const engTotal = Object.values(result.moveCount.engineer).reduce((a, b) => a + b, 0);
    expect(engTotal).toBeGreaterThan(0);
  });

  it("terminates at maxTurns with winner='draw' if no one dies", () => {
    // Tight cap forces a draw
    const result = runGame({
      seed: 1,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
      maxTurns: 2,
    });
    expect(result.turns).toBeLessThanOrEqual(2);
  });

  it("works with aiPolicy on the contractor side", () => {
    const result = runGame({
      seed: 5,
      engPolicy: randomPolicy,
      conPolicy: aiPolicy,
    });
    expect(["engineer", "contractor", "draw"]).toContain(result.winner);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/sim-runGame.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/sim/runGame.js`**

```js
import { reducer, initState } from "../game/reducer.js";
import { seed } from "../game/rng.js";
import { STATUS } from "../constants.js";

const DEFAULT_MAX_TURNS = 500;

export function runGame({ seed: seedValue, engPolicy, conPolicy, maxTurns = DEFAULT_MAX_TURNS }) {
  seed(seedValue);
  // Skip the cosmetic intro phase — sim doesn't need log entries
  let state = { ...initState(), turn: "player" };
  let turns = 0;
  const moveCount = { engineer: {}, contractor: {} };

  while (!state.winner && turns < maxTurns) {
    if (state.turn === "player") {
      if (state.engStatus === STATUS.STUNNED) {
        state = reducer(state, { type: "PLAYER_STUNNED" });
      } else {
        const move = engPolicy(state, "engineer");
        moveCount.engineer[move.name] = (moveCount.engineer[move.name] || 0) + 1;
        state = reducer(state, { type: "PLAYER_MOVE", move });
      }
    } else if (state.turn === "enemy") {
      if (state.conStatus === STATUS.STUNNED) {
        state = reducer(state, { type: "ENEMY_MOVE" });
      } else {
        const move = conPolicy(state, "contractor");
        moveCount.contractor[move.name] = (moveCount.contractor[move.name] || 0) + 1;
        state = reducer(state, { type: "ENEMY_MOVE", move });
      }
    } else {
      // Defensive: any unexpected turn state ends the loop
      break;
    }
    turns++;
  }

  return {
    winner: state.winner || "draw",
    turns,
    moveCount,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/sim-runGame.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/runGame.js src/__tests__/sim-runGame.test.js
git commit -m "feat(sim): add runGame to simulate one match with two policies"
```

---

## Task 6: `runBatch` — aggregate N games into a BalanceReport

**Files:**
- Create: `src/sim/runBatch.js`
- Test: `src/__tests__/sim-runBatch.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/sim-runBatch.test.js`:

```js
import { describe, it, expect, afterEach } from "vitest";
import { runBatch } from "../sim/runBatch.js";
import { randomPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";

afterEach(() => seed(null));

describe("runBatch", () => {
  it("returns a BalanceReport with the expected shape", () => {
    const report = runBatch({
      startSeed: 1,
      count: 10,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
      engPolicyName: "random",
      conPolicyName: "random",
    });
    expect(report.matchup).toBe("random-vs-random");
    expect(report.startSeed).toBe(1);
    expect(report.count).toBe(10);
    expect(report.engineerWinRate).toBeGreaterThanOrEqual(0);
    expect(report.engineerWinRate).toBeLessThanOrEqual(1);
    expect(report.contractorWinRate).toBeGreaterThanOrEqual(0);
    expect(report.drawRate).toBeGreaterThanOrEqual(0);
    expect(report.avgTurns).toBeGreaterThan(0);
    expect(report.moveFrequency).toHaveProperty("engineer");
    expect(report.moveFrequency).toHaveProperty("contractor");
  });

  it("win rates + draw rate sum to 1", () => {
    const r = runBatch({
      startSeed: 1, count: 20,
      engPolicy: randomPolicy, conPolicy: randomPolicy,
      engPolicyName: "random", conPolicyName: "random",
    });
    expect(r.engineerWinRate + r.contractorWinRate + r.drawRate).toBeCloseTo(1, 4);
  });

  it("move frequencies per side sum to 1", () => {
    const r = runBatch({
      startSeed: 1, count: 20,
      engPolicy: randomPolicy, conPolicy: randomPolicy,
      engPolicyName: "random", conPolicyName: "random",
    });
    const engSum = Object.values(r.moveFrequency.engineer).reduce((a, b) => a + b, 0);
    const conSum = Object.values(r.moveFrequency.contractor).reduce((a, b) => a + b, 0);
    expect(engSum).toBeCloseTo(1, 2);
    expect(conSum).toBeCloseTo(1, 2);
  });

  it("is deterministic for identical input", () => {
    const args = {
      startSeed: 3, count: 10,
      engPolicy: randomPolicy, conPolicy: randomPolicy,
      engPolicyName: "random", conPolicyName: "random",
    };
    expect(runBatch(args)).toEqual(runBatch(args));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/sim-runBatch.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/sim/runBatch.js`**

```js
import { runGame } from "./runGame.js";

export function runBatch({ startSeed, count, engPolicy, conPolicy, engPolicyName, conPolicyName }) {
  let engineerWins = 0;
  let contractorWins = 0;
  let draws = 0;
  let totalTurns = 0;
  const totals = { engineer: {}, contractor: {} };

  for (let i = 0; i < count; i++) {
    const { winner, turns, moveCount } = runGame({
      seed: startSeed + i,
      engPolicy,
      conPolicy,
    });
    if (winner === "engineer") engineerWins++;
    else if (winner === "contractor") contractorWins++;
    else draws++;
    totalTurns += turns;
    for (const side of ["engineer", "contractor"]) {
      for (const [name, n] of Object.entries(moveCount[side])) {
        totals[side][name] = (totals[side][name] || 0) + n;
      }
    }
  }

  const moveFrequency = { engineer: {}, contractor: {} };
  for (const side of ["engineer", "contractor"]) {
    const sum = Object.values(totals[side]).reduce((a, b) => a + b, 0) || 1;
    for (const [name, n] of Object.entries(totals[side])) {
      moveFrequency[side][name] = +(n / sum).toFixed(4);
    }
  }

  return {
    matchup: `${engPolicyName}-vs-${conPolicyName}`,
    startSeed,
    count,
    engineerWinRate: +(engineerWins / count).toFixed(4),
    contractorWinRate: +(contractorWins / count).toFixed(4),
    drawRate: +(draws / count).toFixed(4),
    avgTurns: +(totalTurns / count).toFixed(2),
    moveFrequency,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/sim-runBatch.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/runBatch.js src/__tests__/sim-runBatch.test.js
git commit -m "feat(sim): add runBatch to aggregate N games into a BalanceReport"
```

---

## Task 7: CLI script + npm scripts + gitignore

**Files:**
- Create: `scripts/simulate.js`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `scripts/simulate.js`**

```js
#!/usr/bin/env node
// Runs the two standard matchups and writes either balance-report.json or balance-baseline.json.
// Usage:
//   node scripts/simulate.js                         # writes balance-report.json
//   node scripts/simulate.js --update-baseline      # writes balance-baseline.json
//   node scripts/simulate.js --count=200 --seed=1   # tune batch size / seed

import fs from "node:fs";
import { runBatch } from "../src/sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../src/sim/policies.js";

const args = process.argv.slice(2);
const isUpdateBaseline = args.includes("--update-baseline");

function flag(name, fallback) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? Number(arg.split("=")[1]) : fallback;
}

const count = flag("count", 200);
const startSeed = flag("seed", 1);

const matchups = [
  {
    name: "random-vs-random",
    engPolicy: randomPolicy, conPolicy: randomPolicy,
    engPolicyName: "random", conPolicyName: "random",
  },
  {
    name: "random-vs-ai",
    engPolicy: randomPolicy, conPolicy: aiPolicy,
    engPolicyName: "random", conPolicyName: "ai",
  },
];

const report = {
  matchups: matchups.map((m) =>
    runBatch({ startSeed, count, engPolicy: m.engPolicy, conPolicy: m.conPolicy,
               engPolicyName: m.engPolicyName, conPolicyName: m.conPolicyName })
  ),
};

const outPath = isUpdateBaseline ? "balance-baseline.json" : "balance-report.json";
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
for (const m of report.matchups) {
  console.log(
    `  ${m.matchup}: engineer ${(m.engineerWinRate * 100).toFixed(1)}% / ` +
    `contractor ${(m.contractorWinRate * 100).toFixed(1)}% / ` +
    `draw ${(m.drawRate * 100).toFixed(1)}% — avg ${m.avgTurns} turns over ${m.count} games`
  );
}
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, update the `scripts` block from:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run"
}
```

to:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "sim": "node scripts/simulate.js",
  "sim:update-baseline": "node scripts/simulate.js --update-baseline"
}
```

- [ ] **Step 3: Update `.gitignore`**

Append one line to `.gitignore`:

```
balance-report.json
```

Final `.gitignore` contents:

```
node_modules
dist
.vite
balance-report.json
```

- [ ] **Step 4: Verify the script runs**

Run: `npm run sim`
Expected: creates `balance-report.json` at repo root; prints two matchup summary lines.

- [ ] **Step 5: Commit**

```bash
git add scripts/simulate.js package.json .gitignore
git commit -m "feat(sim): add CLI script and npm scripts for simulation runs"
```

---

## Task 8: Establish the balance baseline

One-time action: run the sim with `--update-baseline`, inspect the output, commit it.

**Files:**
- Create: `balance-baseline.json` (generated)

- [ ] **Step 1: Generate the baseline**

Run: `npm run sim:update-baseline`
Expected: creates `balance-baseline.json` at repo root with both matchups.

- [ ] **Step 2: Sanity-check the output**

Open `balance-baseline.json` and verify:
- `matchups` array has 2 entries (`random-vs-random`, `random-vs-ai`).
- Each has `count: 200`, `startSeed: 1`.
- `engineerWinRate + contractorWinRate + drawRate ≈ 1.0`.
- `moveFrequency.engineer` and `moveFrequency.contractor` each contain all 6 moves for that side (spot-check against `content/moves/engineer.json` and `content/moves/contractor.json`).

If anything looks wrong (e.g. a move is missing), stop and investigate before committing — the baseline is a contract.

- [ ] **Step 3: Commit the baseline**

```bash
git add balance-baseline.json
git commit -m "chore(sim): establish balance baseline (200 games per matchup, seed=1)"
```

---

## Task 9: Balance regression test

**Files:**
- Create: `src/__tests__/balance-regression.test.js`

- [ ] **Step 1: Write the test**

Create `src/__tests__/balance-regression.test.js`:

```js
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBatch } from "../sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";

const WIN_RATE_TOLERANCE = 0.03;  // ±3pp
const MOVE_FREQ_TOLERANCE = 0.05; // ±5pp

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.resolve(__dirname, "../../balance-baseline.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));

const policies = { random: randomPolicy, ai: aiPolicy };

afterEach(() => seed(null));

describe("balance regression", () => {
  for (const baselineMatchup of baseline.matchups) {
    it(`${baselineMatchup.matchup} matches baseline within tolerance`, () => {
      const [engName, , conName] = baselineMatchup.matchup.split("-");
      const current = runBatch({
        startSeed: baselineMatchup.startSeed,
        count: baselineMatchup.count,
        engPolicy: policies[engName],
        conPolicy: policies[conName],
        engPolicyName: engName,
        conPolicyName: conName,
      });

      const winRateDelta = Math.abs(current.engineerWinRate - baselineMatchup.engineerWinRate);
      expect(winRateDelta, `engineer win rate drifted by ${(winRateDelta * 100).toFixed(2)}pp`)
        .toBeLessThanOrEqual(WIN_RATE_TOLERANCE);

      for (const side of ["engineer", "contractor"]) {
        for (const [moveName, baseFreq] of Object.entries(baselineMatchup.moveFrequency[side])) {
          const curFreq = current.moveFrequency[side][moveName] || 0;
          const delta = Math.abs(curFreq - baseFreq);
          expect(delta, `${side} ${moveName} frequency drifted by ${(delta * 100).toFixed(2)}pp`)
            .toBeLessThanOrEqual(MOVE_FREQ_TOLERANCE);
        }
      }
    });
  }
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all prior tests pass + 2 new balance regression tests pass (one per matchup). Because the baseline was generated from the same code with the same seed + count, current-vs-baseline deltas should be ~0.

If the test fails, the most likely cause is the baseline was generated with different code than what's currently checked in. Re-run `npm run sim:update-baseline` and re-commit.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/balance-regression.test.js
git commit -m "test(sim): add balance regression test comparing to committed baseline"
```

---

## Phase 1 Acceptance Verification

After Task 9, verify the full acceptance criteria from `ROADMAP.md`:

- [ ] `npm run sim` produces `balance-report.json` with deterministic numbers (run twice, compare — should be byte-identical).
- [ ] `balance-baseline.json` is committed. `npm run sim:update-baseline` overwrites it.
- [ ] `npm test` runs all prior tests + new sim + balance regression tests, all green.
- [ ] `git log` shows a clean sequence of small commits, one per task.
- [ ] `ROADMAP.md` Phase 1 "What done looks like" criteria all pass.

Mark Phase 1 complete in `ROADMAP.md` if desired (optional — a later phase's plan can do this).
