# Dialog Realism — Phase D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Crafted Foundation" of context-aware dialog: every quote picks a pool keyed by the opponent's last move, and 13 canonical counter pairings apply a ×1.3 damage bonus + guaranteed status kicker with dedicated narrative lines.

**Architecture:** Two new pure modules (`src/game/dialog.js`, `src/game/counters.js`) own quote selection and counter detection. `resolveMove()` threads `opponentLastMove` through them. Reducer tracks `engLastMove` / `conLastMove`. Content schema extends backward-compatibly from flat arrays to `{default, opening?, vs_*?}` objects. Authoring pipeline (`scripts/dialog-author/*.js`) generates canonical content via Claude CLI role-play + human curation. No runtime LLM; fully deterministic; sim-safe.

**Tech Stack:** JavaScript (ES modules), React 18 + Vite, Vitest. Node ≥22 (JSON import attributes). No new dependencies — authoring scripts reuse `src/tune/claudeTransport.js` pattern for Claude CLI subprocess calls.

**Reference spec:** `plans/2026-04-14-dialog-realism-d1-design.md`

---

## File Structure

**New files:**
- `src/game/dialog.js` — `pickDialog({ attackerSide, move, opponentLastMove, isOpening })`, `vsKey(moveName)`
- `src/game/counters.js` — `COUNTER_ROUTING` table, `isCounter()`, `getCounterEntry()`
- `src/__tests__/dialog.test.js`
- `src/__tests__/counters.test.js`
- `src/__tests__/dialog-integration.test.js`
- `scripts/dialog-author/research.js`
- `scripts/dialog-author/roleplay.js`
- `scripts/dialog-author/mine.js`
- `scripts/dialog-author/coverage.js`
- `docs/dialog-source-material.md` (produced by research stage)

**Modified files:**
- `content/game.json` — add `counterMultiplier`, `aiCounterBias`
- `src/data/content-loader.js` — normalize quotes to object-shape on load
- `src/game/logic.js` — `pickDialog` integration; `isCounter` args on `calculateDamage`/`rollStatusEffect`; ⚔️ COUNTER log line; counter-bias in `pickAIMove`
- `src/game/reducer.js` — `engLastMove` / `conLastMove` state fields; thread opponent last move into `resolveMove`
- `content/quotes/engineer.json` — migrate to object-shape; seed `vs_*` content for engineer canonical counters
- `content/quotes/contractor.json` — migrate; seed `vs_*` content for contractor canonical counters
- `balance-baseline.json` — regenerate (expected shift)
- `src/__tests__/constants.test.js` — structural assertions for new GAME keys
- `src/__tests__/content-integrity.test.js` — validate object-shape schema
- `src/__tests__/content-loader.test.js` — cover both legacy and new shapes
- `src/__tests__/logic.test.js` — `isCounter` behavior; log line
- `src/__tests__/reducer.test.js` — last-move tracking; no-update on stun
- `src/__tests__/sim-policies.test.js` — AI counter bias
- `.gitignore` — add `scratch/`
- `CLAUDE.md` — document dialog system + authoring pipeline

---

## Conventions used in this plan

- **Commit style:** `<type>(<scope>): <subject>` with trailer `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`. Run commits via heredoc for multi-line messages.
- **Test runner:** all tests via `npm test` or single file via `npx vitest run <path>`.
- **Between tasks:** always run `npm test` before committing to confirm the full suite passes. If a task is expected to produce a RED state until a later task, the plan calls it out explicitly.
- **RNG in tests:** seed with `seed(n)` from `src/game/rng.js` when determinism is needed.

---

## Task 1: Add counter-related game constants

**Files:**
- Modify: `content/game.json`
- Test: `src/__tests__/constants.test.js`

- [ ] **Step 1: Add failing test**

Add to `src/__tests__/constants.test.js` inside the `describe("Game Balance Constants (structural)", ...)` block:

```js
  it("has counterMultiplier as a number in [1.0, 2.0]", () => {
    expect(typeof GAME.counterMultiplier).toBe("number");
    expect(GAME.counterMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(GAME.counterMultiplier).toBeLessThanOrEqual(2.0);
  });

  it("has aiCounterBias as a number in [0, 1]", () => {
    expect(typeof GAME.aiCounterBias).toBe("number");
    expect(GAME.aiCounterBias).toBeGreaterThanOrEqual(0);
    expect(GAME.aiCounterBias).toBeLessThanOrEqual(1);
  });
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/__tests__/constants.test.js`
Expected: FAIL — both new assertions fail because the keys don't exist yet.

- [ ] **Step 3: Add the constants to game.json**

Update `content/game.json` to:

```json
{
  "critRate": 0.12,
  "critMultiplier": 1.6,
  "mpRegen": 4,
  "stunChance": 0.3,
  "slowChance": 0.4,
  "weakenedMultiplier": 1.3,
  "defMultiplier": 0.5,
  "healRange": [
    28,
    45
  ],
  "counterMultiplier": 1.3,
  "aiCounterBias": 0.7
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/__tests__/constants.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass (no baseline-regression failures yet — counters aren't wired in).

- [ ] **Step 6: Commit**

```bash
git add content/game.json src/__tests__/constants.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): add counterMultiplier and aiCounterBias to game config

Groundwork for D1 counter mechanics. Values not yet wired into
logic — this task just adds the knobs and their structural tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create counter-routing module

**Files:**
- Create: `src/game/counters.js`
- Create: `src/__tests__/counters.test.js`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/counters.test.js`:

```js
import { describe, it, expect } from "vitest";
import { COUNTER_ROUTING, isCounter, getCounterEntry } from "../game/counters.js";

describe("COUNTER_ROUTING table", () => {
  it("has 13 entries", () => {
    expect(COUNTER_ROUTING).toHaveLength(13);
  });

  it("every entry has initiator, counterer, counterMove", () => {
    COUNTER_ROUTING.forEach((e) => {
      expect(e).toHaveProperty("initiator");
      expect(e).toHaveProperty("counterer");
      expect(e).toHaveProperty("counterMove");
      expect(["engineer", "contractor"]).toContain(e.counterer);
    });
  });
});

describe("isCounter", () => {
  it("returns true for a canonical engineer counter", () => {
    expect(isCounter("engineer", "INVOKE SHALL", "OR-EQUAL GAMBIT")).toBe(true);
  });

  it("returns true for a canonical contractor counter", () => {
    expect(isCounter("contractor", "SUBMIT RFI", "INVOKE SHALL")).toBe(true);
  });

  it("returns false when side is wrong", () => {
    expect(isCounter("contractor", "INVOKE SHALL", "OR-EQUAL GAMBIT")).toBe(false);
  });

  it("returns false when opponent last move doesn't match", () => {
    expect(isCounter("engineer", "INVOKE SHALL", "SUBMIT RFI")).toBe(false);
  });

  it("returns false when opponent last move is null", () => {
    expect(isCounter("engineer", "INVOKE SHALL", null)).toBe(false);
  });

  it("returns false for unknown move names", () => {
    expect(isCounter("engineer", "MAKE COFFEE", "OR-EQUAL GAMBIT")).toBe(false);
  });
});

describe("getCounterEntry", () => {
  it("returns the matching entry for a counter", () => {
    const entry = getCounterEntry("engineer", "INVOKE SHALL", "OR-EQUAL GAMBIT");
    expect(entry).not.toBeNull();
    expect(entry.initiator).toBe("OR-EQUAL GAMBIT");
    expect(entry.counterMove).toBe("INVOKE SHALL");
  });

  it("returns null when no counter matches", () => {
    expect(getCounterEntry("engineer", "INVOKE SHALL", "SUBMIT RFI")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/__tests__/counters.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/game/counters.js`**

```js
// Canonical counter pairings. Each entry describes:
//   - initiator: the move name played on turn N that this entry counters
//   - counterer: which side is playing the counter move ("engineer" or "contractor")
//   - counterMove: the move name played on turn N+1 that earns the bonus
//
// When (side, move, opponentLastMove) matches an entry, resolveMove applies
// a damage multiplier (GAME.counterMultiplier) AND guarantees any status effect
// the counter move would normally roll for. Dialog is also sourced from the
// move's `vs_<initiator>` bucket.
export const COUNTER_ROUTING = [
  // Engineer counters
  { initiator: "OR-EQUAL GAMBIT", counterer: "engineer",  counterMove: "INVOKE SHALL" },
  { initiator: "CLAIM DSC",        counterer: "engineer",  counterMove: "INVOKE SHALL" },
  { initiator: "VALUE ENGINEER",   counterer: "engineer",  counterMove: "ISSUE NCR" },
  { initiator: "SCHEDULE DELAY",   counterer: "engineer",  counterMove: "CURE NOTICE" },
  { initiator: "SUBMIT RFI",       counterer: "engineer",  counterMove: "CITE UFC" },
  { initiator: "OR-EQUAL GAMBIT",  counterer: "engineer",  counterMove: "RED-LINE SPEC" },
  { initiator: "SUBMIT RFI",       counterer: "engineer",  counterMove: "REJECT SUBMITTAL" },
  // Contractor counters
  { initiator: "CITE UFC",         counterer: "contractor", counterMove: "CLAIM DSC" },
  { initiator: "CURE NOTICE",      counterer: "contractor", counterMove: "RESERVE RIGHTS" },
  { initiator: "ISSUE NCR",        counterer: "contractor", counterMove: "SCHEDULE DELAY" },
  { initiator: "INVOKE SHALL",     counterer: "contractor", counterMove: "SUBMIT RFI" },
  { initiator: "REJECT SUBMITTAL", counterer: "contractor", counterMove: "VALUE ENGINEER" },
  { initiator: "RED-LINE SPEC",    counterer: "contractor", counterMove: "OR-EQUAL GAMBIT" },
];

export function getCounterEntry(attackerSide, moveName, opponentLastMoveName) {
  if (!opponentLastMoveName) return null;
  return COUNTER_ROUTING.find(
    (e) =>
      e.counterer === attackerSide &&
      e.counterMove === moveName &&
      e.initiator === opponentLastMoveName,
  ) || null;
}

export function isCounter(attackerSide, moveName, opponentLastMoveName) {
  return getCounterEntry(attackerSide, moveName, opponentLastMoveName) !== null;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/__tests__/counters.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/counters.js src/__tests__/counters.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): add counter-routing module with 13 canonical pairings

Pure module exporting COUNTER_ROUTING table plus isCounter() /
getCounterEntry() helpers. Not yet wired into resolveMove.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create dialog selection module

**Files:**
- Create: `src/game/dialog.js`
- Create: `src/__tests__/dialog.test.js`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/dialog.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { pickDialog, vsKey } from "../game/dialog.js";
import { seed } from "../game/rng.js";

describe("vsKey", () => {
  it("normalizes a simple move name", () => {
    expect(vsKey("INVOKE SHALL")).toBe("vs_INVOKE_SHALL");
  });

  it("normalizes hyphens and spaces", () => {
    expect(vsKey("OR-EQUAL GAMBIT")).toBe("vs_OR_EQUAL_GAMBIT");
    expect(vsKey("RED-LINE SPEC")).toBe("vs_RED_LINE_SPEC");
  });

  it("preserves case", () => {
    expect(vsKey("Foo-Bar Baz")).toBe("vs_Foo_Bar_Baz");
  });
});

describe("pickDialog", () => {
  const move = {
    name: "REJECT SUBMITTAL",
    quotes: {
      default: ["default line a", "default line b"],
      opening: ["opening line"],
      vs_SUBMIT_RFI: ["rfi-specific line a", "rfi-specific line b"],
    },
  };

  beforeEach(() => seed(1));

  it("picks from opening bucket when isOpening is true", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: null, isOpening: true });
    expect(q).toBe("opening line");
  });

  it("picks from opening when both isOpening AND opponentLastMove are present (opening wins)", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: true });
    expect(q).toBe("opening line");
  });

  it("picks from vs_<OPPONENT_MOVE> bucket when it exists", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: false });
    expect(["rfi-specific line a", "rfi-specific line b"]).toContain(q);
  });

  it("falls back to default when vs bucket missing", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "CLAIM DSC", isOpening: false });
    expect(["default line a", "default line b"]).toContain(q);
  });

  it("falls back to default when opening requested but empty", () => {
    const noOpening = { name: "X", quotes: { default: ["d"] } };
    const q = pickDialog({ attackerSide: "engineer", move: noOpening, opponentLastMove: null, isOpening: true });
    expect(q).toBe("d");
  });

  it("is deterministic under a seeded RNG", () => {
    seed(42);
    const a = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: false });
    seed(42);
    const b = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: false });
    expect(a).toBe(b);
  });

  it("handles moves where quotes is still a flat array (legacy support)", () => {
    const legacy = { name: "X", quotes: ["legacy a", "legacy b"] };
    const q = pickDialog({ attackerSide: "engineer", move: legacy, opponentLastMove: null, isOpening: false });
    expect(["legacy a", "legacy b"]).toContain(q);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/__tests__/dialog.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/game/dialog.js`**

```js
import { pick } from "./rng.js";

/**
 * Normalize a move name to its `vs_*` bucket key. Replaces both spaces and
 * hyphens with underscores; preserves case. Matches the normalization that
 * content-loader applies when it validates quote bucket keys.
 */
export function vsKey(moveName) {
  return "vs_" + moveName.replace(/[ -]/g, "_");
}

/**
 * Select a quote string for the given attacker, move, and context.
 *
 * Selection priority:
 *   1. If isOpening and move.quotes.opening is a non-empty array → pick from it.
 *   2. Else if opponentLastMove and move.quotes[vsKey(opponentLastMove)] is a
 *      non-empty array → pick from it.
 *   3. Else → pick from move.quotes.default.
 *
 * Legacy backward-compat: if move.quotes is a flat array (not an object),
 * treat it as the default pool.
 */
export function pickDialog({ attackerSide, move, opponentLastMove, isOpening }) {
  const q = move.quotes;

  // Legacy flat-array shape.
  if (Array.isArray(q)) {
    return pick(q);
  }

  if (isOpening && Array.isArray(q.opening) && q.opening.length > 0) {
    return pick(q.opening);
  }

  if (opponentLastMove) {
    const bucket = q[vsKey(opponentLastMove)];
    if (Array.isArray(bucket) && bucket.length > 0) {
      return pick(bucket);
    }
  }

  return pick(q.default);
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/__tests__/dialog.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/dialog.js src/__tests__/dialog.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): add pickDialog module with opening/vs/default fallback

Pure module. vsKey() normalizes move names to bucket keys (spaces
and hyphens → underscores, preserving case). pickDialog selects
opening > vs_<opponent> > default, with flat-array legacy support.
Not yet wired into resolveMove.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Normalize quote shape in content-loader

**Files:**
- Modify: `src/data/content-loader.js`
- Test: `src/__tests__/content-loader.test.js`

**Goal:** Any shape of `content/quotes/*.json` (flat array OR object with `default`/`opening`/`vs_*`) loads to a uniform object shape exposed on `move.quotes`. Unknown `vs_*` keys throw at load time.

- [ ] **Step 1: Look at existing content-loader tests**

Run: `npx vitest run src/__tests__/content-loader.test.js --reporter=verbose`
Read the output to confirm which tests exist and what shape they assume. Existing tests will break if they expect `move.quotes` to be an array. You may need to update them in Step 4.

- [ ] **Step 2: Write failing tests**

Append to `src/__tests__/content-loader.test.js`:

```js
import { describe as d2, it as i2, expect as e2 } from "vitest";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";

d2("quote shape normalization", () => {
  i2("every engineer move has quotes as an object with `default` array", () => {
    ENGINEER.moves.forEach((m) => {
      e2(m.quotes).toBeTypeOf("object");
      e2(Array.isArray(m.quotes.default)).toBe(true);
      e2(m.quotes.default.length).toBeGreaterThan(0);
    });
  });

  i2("every contractor move has quotes as an object with `default` array", () => {
    CONTRACTOR.moves.forEach((m) => {
      e2(m.quotes).toBeTypeOf("object");
      e2(Array.isArray(m.quotes.default)).toBe(true);
      e2(m.quotes.default.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npx vitest run src/__tests__/content-loader.test.js`
Expected: FAIL — today `move.quotes` is a flat array, so `m.quotes.default` is undefined.

- [ ] **Step 4: Implement normalization in `src/data/content-loader.js`**

Replace the `buildMoves` function and add `normalizeQuotes` + `validateVsKeys`. The full new file body:

```js
import { C, GAME, pick } from "../constants.js";

// Import JSON content
import engineerMoves from "../../content/moves/engineer.json" with { type: "json" };
import contractorMoves from "../../content/moves/contractor.json" with { type: "json" };
import engineerQuotes from "../../content/quotes/engineer.json" with { type: "json" };
import contractorQuotes from "../../content/quotes/contractor.json" with { type: "json" };
import introsData from "../../content/intros.json" with { type: "json" };
import gameOverData from "../../content/game-over.json" with { type: "json" };

const COLOR_MAP = {
  yellow: C.yellow, white: C.white, orange: C.orange, red: C.red,
  cyan: C.cyan, bright: C.bright, muted: C.muted, hpGreen: C.hpGreen,
};

function resolveColor(name) {
  return COLOR_MAP[name] || C.white;
}

function vsKey(moveName) {
  return "vs_" + moveName.replace(/[ -]/g, "_");
}

// Convert either a flat-array legacy value or an object-shape value into a
// uniform { default: [...], opening?: [...], vs_*?: [...] } object.
function normalizeQuotes(raw) {
  if (Array.isArray(raw)) {
    return { default: raw };
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.default)) {
    return raw;
  }
  return { default: [] };
}

// Throws if any vs_* key on any move doesn't correspond to a real opponent
// move. Called at load; fails fast so content bugs surface immediately.
function validateVsKeys(quoteBag, opponentMoves, label) {
  const validKeys = new Set(opponentMoves.map((m) => vsKey(m.name)));
  Object.entries(quoteBag).forEach(([moveName, q]) => {
    const normalized = normalizeQuotes(q);
    Object.keys(normalized).forEach((key) => {
      if (key === "default" || key === "opening") return;
      if (!key.startsWith("vs_")) {
        throw new Error(
          `[${label}] unknown quote bucket key '${key}' on move '${moveName}'`,
        );
      }
      if (!validKeys.has(key)) {
        throw new Error(
          `[${label}] vs_* key '${key}' on move '${moveName}' does not match any opponent move`,
        );
      }
    });
  });
}

function buildMoves(moveDefs, quoteBag) {
  return moveDefs.map((move) => ({
    ...move,
    quotes: normalizeQuotes(quoteBag[move.name]),
  }));
}

validateVsKeys(engineerQuotes, contractorMoves, "engineer");
validateVsKeys(contractorQuotes, engineerMoves, "contractor");

export const ENGINEER = {
  name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: GAME.mpRegen,
  moves: buildMoves(engineerMoves, engineerQuotes),
};

export const CONTRACTOR = {
  name: "CONTRACTOR", maxHp: 150, maxMp: 60, mpRegen: GAME.mpRegen,
  moves: buildMoves(contractorMoves, contractorQuotes),
};

const INTRO_SEQUENCES = introsData.map((intro) =>
  intro.steps.map((step) => ({
    entry: { text: step.text, color: resolveColor(step.color) },
    delay: step.delay,
  })),
);

export const pickIntroSequence = () => pick(INTRO_SEQUENCES);

export const GAME_OVER_TEXT = gameOverData;
```

- [ ] **Step 5: Update any broken existing tests**

If Step 3 revealed that older tests expected `move.quotes` to be an array, update them to use `move.quotes.default`. Specifically, look for patterns like `move.quotes.length` or `move.quotes[0]` in `content-loader.test.js`.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: All tests pass EXCEPT possibly `logic.test.js` (its `resolveMove` still calls `pick(move.quotes)` which no longer works on objects — if that test fails, the failure is expected and will be fixed in Task 6). The content-loader tests and content-integrity tests should be green.

If `logic.test.js` was failing, ALSO check if the dev server is still buildable:

Run: `npm run build`
Expected: build succeeds.

The game won't render correctly in the browser yet (same reason — `pick(move.quotes)` on an object fails) but the JS build is fine.

- [ ] **Step 7: Commit**

```bash
git add src/data/content-loader.js src/__tests__/content-loader.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): normalize quote shape in content-loader

Accepts both legacy flat-array and new { default, opening?, vs_*? }
object shape; emits uniform object shape on move.quotes. Validates
vs_* keys against opponent moves at load time — fails fast on
unknown keys. resolveMove still uses pick(move.quotes) and is
expected to be broken at this point; Task 6 wires pickDialog in.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update content-integrity to validate object schema

**Files:**
- Modify: `src/__tests__/content-integrity.test.js`

- [ ] **Step 1: Update the validation helper**

Replace the `validateMoves` function in `src/__tests__/content-integrity.test.js` with the version below. It accepts both legacy and new shape and enforces schema rules on the new shape:

```js
function validateMoves(moves, quotes, opponentMoves, label) {
  const opponentMoveNames = new Set(opponentMoves.map((m) => m.name));
  const vsKeyFor = (n) => "vs_" + n.replace(/[ -]/g, "_");

  describe(`${label} moves`, () => {
    it("has at least 1 move", () => {
      expect(moves.length).toBeGreaterThan(0);
    });

    moves.forEach((move) => {
      describe(`${move.name}`, () => {
        it("has required fields", () => {
          expect(move).toHaveProperty("name");
          expect(move).toHaveProperty("emoji");
          expect(move).toHaveProperty("desc");
          expect(move).toHaveProperty("dmg");
          expect(move).toHaveProperty("mp");
          expect(move).toHaveProperty("effect");
        });

        it("has valid dmg range [min, max]", () => {
          expect(move.dmg).toHaveLength(2);
          expect(move.dmg[0]).toBeTypeOf("number");
          expect(move.dmg[1]).toBeTypeOf("number");
          expect(move.dmg[0]).toBeLessThanOrEqual(move.dmg[1]);
        });

        it("has non-negative MP cost", () => {
          expect(move.mp).toBeGreaterThanOrEqual(0);
        });

        it("has valid effect type", () => {
          expect(VALID_EFFECTS).toContain(move.effect);
        });

        const raw = quotes[move.name];
        const isObjectShape = raw && !Array.isArray(raw) && typeof raw === "object";

        if (isObjectShape) {
          it("has required `default` bucket with ≥2 lines", () => {
            expect(Array.isArray(raw.default)).toBe(true);
            expect(raw.default.length).toBeGreaterThanOrEqual(2);
          });

          it("all populated vs_* buckets reference real opponent moves and have ≥2 lines", () => {
            Object.entries(raw).forEach(([k, v]) => {
              if (k === "default" || k === "opening") return;
              expect(k).toMatch(/^vs_/);
              const fromName = [...opponentMoveNames].find((n) => vsKeyFor(n) === k);
              expect(fromName, `vs_* key '${k}' must match an opponent move`).toBeDefined();
              expect(Array.isArray(v)).toBe(true);
              expect(v.length).toBeGreaterThanOrEqual(2);
            });
          });

          it("opening bucket (if present) has ≥2 lines", () => {
            if (raw.opening !== undefined) {
              expect(Array.isArray(raw.opening)).toBe(true);
              expect(raw.opening.length).toBeGreaterThanOrEqual(2);
            }
          });

          it("no duplicate lines within a bucket", () => {
            Object.values(raw).forEach((bucket) => {
              if (!Array.isArray(bucket)) return;
              expect(new Set(bucket).size).toBe(bucket.length);
            });
          });

          it("all quote lines are non-empty strings", () => {
            Object.values(raw).forEach((bucket) => {
              if (!Array.isArray(bucket)) return;
              bucket.forEach((q) => {
                expect(q).toBeTypeOf("string");
                expect(q.trim().length).toBeGreaterThan(0);
              });
            });
          });
        } else {
          // Legacy flat-array shape — preserve existing rules
          it("has matching quotes with at least 3 entries", () => {
            expect(raw).toBeDefined();
            expect(raw.length).toBeGreaterThanOrEqual(3);
          });

          it("has no duplicate quotes", () => {
            if (raw) {
              const unique = new Set(raw);
              expect(unique.size).toBe(raw.length);
            }
          });

          it("all quotes are non-empty strings", () => {
            (raw || []).forEach((q) => {
              expect(q).toBeTypeOf("string");
              expect(q.trim().length).toBeGreaterThan(0);
            });
          });
        }
      });
    });
  });
}
```

And update the call sites near line 71:

```js
validateMoves(engineerMoves, engineerQuotes, contractorMoves, "Engineer");
validateMoves(contractorMoves, contractorQuotes, engineerMoves, "Contractor");
```

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: content-integrity tests pass (either branch applies based on current file shape). Other tests unchanged from Task 4's state.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/content-integrity.test.js
git commit -m "$(cat <<'EOF'
test(content): dual-shape validation for quote integrity

validateMoves now accepts both legacy flat-array and new object
shape for content/quotes/*.json. Object shape enforces: default
required (≥2 lines), vs_* keys must resolve to real opponent
moves (≥2 lines each), opening (if present) ≥2 lines, no dupes
within a bucket.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Integrate pickDialog into resolveMove

**Files:**
- Modify: `src/game/logic.js`
- Modify: `src/game/reducer.js` (signature change only)
- Test: `src/__tests__/logic.test.js`

**Goal:** `resolveMove` calls `pickDialog` with opening/opponentLastMove context instead of `pick(move.quotes)` directly. This restores game functionality broken in Task 4. Still no counter mechanics — Task 7 and 8 add those.

- [ ] **Step 1: Update `resolveMove` in `src/game/logic.js`**

Replace the top of `resolveMove` (the signature and the first two lines) to accept and use `opponentLastMove`:

```js
import { C, STATUS, GAME, clamp } from "../constants.js";
import { random, rand, pick } from "./rng.js";
import { CONTRACTOR } from "../data/characters.js";
import { pickDialog } from "./dialog.js";

// ... calculateDamage unchanged for now ...
// ... rollStatusEffect unchanged for now ...

export function resolveMove(state, attacker, move, isPlayer, opponentLastMove = null) {
  let s = { ...state };
  const isOpening = isPlayer ? state.engLastMove == null : state.conLastMove == null;
  const attackerSide = isPlayer ? "engineer" : "contractor";
  const quote = pickDialog({ attackerSide, move, opponentLastMove, isOpening });
  // ... rest of resolveMove unchanged ...
```

**Note:** `state.engLastMove` / `state.conLastMove` don't exist yet — they're undefined, which compares `== null` as true, so `isOpening` is true on the first turn. Task 9 adds the real tracking.

- [ ] **Step 2: Update reducer call sites in `src/game/reducer.js`**

Change the two call sites in `reducer.js` to pass `opponentLastMove`:

In `PLAYER_MOVE`:
```js
let s = resolveMove(state, ENGINEER, move, true, state.conLastMove);
```

In `ENEMY_MOVE`:
```js
let s = resolveMove(state, CONTRACTOR, move, false, state.engLastMove);
```

(Again, these fields are undefined for now; Task 9 adds the real state.)

- [ ] **Step 3: Fix existing logic tests**

Existing tests in `src/__tests__/logic.test.js` that call `resolveMove(state, attacker, move, isPlayer)` still work (5th arg defaults to null). But if any test expects a specific quote from a flat-array pool, it will fail against the new object-shape `move.quotes.default`. Run the suite to identify any breakage:

Run: `npx vitest run src/__tests__/logic.test.js`

Fix any test that hardcoded a quote string assumption by either (a) stubbing with an object-shape move, or (b) asserting the quote is IN the default pool rather than exactly equal.

- [ ] **Step 4: Add a new test asserting pickDialog wiring**

Append to `src/__tests__/logic.test.js`:

```js
import { seed as seedRng } from "../game/rng.js";

describe("resolveMove dialog routing", () => {
  it("pulls quote from vs_<opponent> bucket when opponentLastMove is set", () => {
    seedRng(7);
    const move = {
      name: "REJECT SUBMITTAL", emoji: "🚫", desc: "", dmg: [10, 10], mp: 0, effect: null,
      quotes: {
        default: ["default quote"],
        vs_SUBMIT_RFI: ["vs-rfi quote a", "vs-rfi quote b"],
      },
    };
    const attacker = { name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: 4 };
    const state = {
      engHp: 140, engMp: 70, conHp: 150, conMp: 60,
      engStatus: null, conStatus: null, log: [],
      engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
      engLastMove: "CITE UFC", conLastMove: "SUBMIT RFI",
    };
    const s = resolveMove(state, attacker, move, true, "SUBMIT RFI");
    const quoteLine = s.log.find((e) => e.text.startsWith("  \""));
    expect(quoteLine.text).toMatch(/vs-rfi quote [ab]/);
  });
});
```

- [ ] **Step 5: Run test to verify pass**

Run: `npx vitest run src/__tests__/logic.test.js`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: All tests pass.

Run: `npm run build && npm run dev` briefly — confirm the app renders. (Stop the dev server with Ctrl+C after visual confirmation — a quote appears in battle log.) No runtime assertions here; this is a smoke check.

- [ ] **Step 7: Commit**

```bash
git add src/game/logic.js src/game/reducer.js src/__tests__/logic.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): wire pickDialog into resolveMove

resolveMove now routes quote selection through dialog.pickDialog
with opening/vs/default priority. Reducer threads opponentLastMove
through both PLAYER_MOVE and ENEMY_MOVE paths. Counter mechanics
still not wired (Tasks 7-8).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add isCounter param to damage and status calculations

**Files:**
- Modify: `src/game/logic.js`
- Test: `src/__tests__/logic.test.js`

**Goal:** `calculateDamage(move, defenderStatus, isCounter)` and `rollStatusEffect(move, isCounter)` accept an optional counter flag. Not yet wired into `resolveMove`.

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/logic.test.js`:

```js
import { calculateDamage, rollStatusEffect } from "../game/logic.js";
import { STATUS, GAME } from "../constants.js";

describe("calculateDamage with isCounter", () => {
  it("applies counterMultiplier when isCounter is true", () => {
    seedRng(1);
    const move = { dmg: [10, 10], effect: null };
    const noCounter = calculateDamage(move, null, false);
    seedRng(1);
    const withCounter = calculateDamage(move, null, true);
    // counterMultiplier × same base roll (crit outcome identical due to reseed)
    expect(withCounter.dmg).toBe(Math.floor(noCounter.dmg * GAME.counterMultiplier));
  });

  it("counter multiplier applies BEFORE crit (crit multiplies the counter-bonused base)", () => {
    // We verify ordering by forcing a crit via seeded RNG and asserting dmg is
    // Math.floor(base × counterMultiplier × critMultiplier).
    // This is a structural assertion — exact numbers depend on the seeded roll.
    seedRng(1);
    const move = { dmg: [10, 10], effect: null };
    const r = calculateDamage(move, null, true);
    if (r.crit) {
      expect(r.dmg).toBe(Math.floor(10 * GAME.counterMultiplier * GAME.critMultiplier));
    }
  });
});

describe("rollStatusEffect with isCounter", () => {
  it("returns STUNNED guaranteed when isCounter is true and move has stun effect", () => {
    const move = { effect: "stun" };
    // Run many iterations to verify determinism even if RNG would have missed
    for (let i = 0; i < 20; i++) {
      seedRng(i);
      expect(rollStatusEffect(move, true)).toBe(STATUS.STUNNED);
    }
  });

  it("returns SLOWED guaranteed when isCounter is true and move has slow effect", () => {
    const move = { effect: "slow" };
    for (let i = 0; i < 20; i++) {
      seedRng(i);
      expect(rollStatusEffect(move, true)).toBe(STATUS.SLOWED);
    }
  });

  it("returns WEAKENED when isCounter is true and move has weaken effect (unchanged — weaken was already always-on)", () => {
    expect(rollStatusEffect({ effect: "weaken" }, true)).toBe(STATUS.WEAKENED);
  });

  it("is a no-op (null) when isCounter is true but move has no status effect", () => {
    expect(rollStatusEffect({ effect: null }, true)).toBe(null);
    expect(rollStatusEffect({ effect: "heal" }, true)).toBe(null);
    expect(rollStatusEffect({ effect: "defense" }, true)).toBe(null);
  });

  it("behaves like today when isCounter is false (default)", () => {
    seedRng(1);
    const a = rollStatusEffect({ effect: "stun" }, false);
    seedRng(1);
    const b = rollStatusEffect({ effect: "stun" });  // default = false
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/__tests__/logic.test.js`
Expected: FAIL — `calculateDamage` and `rollStatusEffect` don't take `isCounter`.

- [ ] **Step 3: Update `calculateDamage` and `rollStatusEffect` in `src/game/logic.js`**

```js
export function calculateDamage(move, defenderStatus, isCounter = false) {
  let dmg = rand(move.dmg[0], move.dmg[1]);
  if (isCounter) dmg = Math.floor(dmg * GAME.counterMultiplier);
  const crit = random() < GAME.critRate;
  if (crit) dmg = Math.floor(dmg * GAME.critMultiplier);
  if (defenderStatus === STATUS.DEF_PLUS) dmg = Math.floor(dmg * GAME.defMultiplier);
  if (defenderStatus === STATUS.WEAKENED) dmg = Math.floor(dmg * GAME.weakenedMultiplier);
  return { dmg, crit };
}

export function rollStatusEffect(move, isCounter = false) {
  if (move.effect === "weaken") return STATUS.WEAKENED;
  if (move.effect === "stun") {
    if (isCounter) return STATUS.STUNNED;
    if (random() < GAME.stunChance) return STATUS.STUNNED;
  }
  if (move.effect === "slow") {
    if (isCounter) return STATUS.SLOWED;
    if (random() < GAME.slowChance) return STATUS.SLOWED;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/__tests__/logic.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: All tests pass. Baseline-regression still green (isCounter isn't wired so mechanics unchanged in practice).

- [ ] **Step 6: Commit**

```bash
git add src/game/logic.js src/__tests__/logic.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): add isCounter flag to damage and status calculations

calculateDamage multiplies by GAME.counterMultiplier before crit
when isCounter=true. rollStatusEffect bypasses random roll and
guarantees stun/slow when isCounter=true and the move has that
effect. Not yet wired into resolveMove.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire counter detection into resolveMove with ⚔️ log line

**Files:**
- Modify: `src/game/logic.js`
- Test: `src/__tests__/logic.test.js`

- [ ] **Step 1: Write failing test**

Append to `src/__tests__/logic.test.js`:

```js
describe("resolveMove counter detection", () => {
  it("applies counter bonus and emits ⚔️ COUNTER log line on canonical counter", () => {
    seedRng(123);
    const invokeShall = {
      name: "INVOKE SHALL", emoji: "⚖️", desc: "", dmg: [30, 30], mp: 20, effect: "stun",
      quotes: { default: ["default shall"], vs_OR_EQUAL_GAMBIT: ["SHALL-slam line"] },
    };
    const state = {
      engHp: 140, engMp: 70, conHp: 150, conMp: 60,
      engStatus: null, conStatus: null, log: [],
      engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
      engLastMove: null, conLastMove: "OR-EQUAL GAMBIT",
    };
    const attacker = { name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: 4 };
    const s = resolveMove(state, attacker, invokeShall, true, "OR-EQUAL GAMBIT");

    // ⚔️ COUNTER line exists
    const counterLine = s.log.find((e) => e.text.startsWith("⚔️ COUNTER"));
    expect(counterLine).toBeDefined();
    expect(counterLine.text).toContain("INVOKE SHALL");
    expect(counterLine.text).toContain("OR-EQUAL GAMBIT");

    // Damage applied counter multiplier — damage is Math.floor(30 × 1.3 × possibly crit)
    const dmgLine = s.log.find((e) => e.text.match(/damage!/));
    const dmgMatch = dmgLine.text.match(/(\d+) damage/);
    const dmg = parseInt(dmgMatch[1], 10);
    expect(dmg).toBeGreaterThanOrEqual(Math.floor(30 * 1.3));

    // Stun guaranteed
    expect(s.conStatus).toBe(STATUS.STUNNED);

    // Quote from vs bucket
    const quoteLine = s.log.find((e) => e.text.includes("SHALL-slam"));
    expect(quoteLine).toBeDefined();
  });

  it("does NOT emit counter line when move is not a counter", () => {
    seedRng(5);
    const move = {
      name: "INVOKE SHALL", emoji: "⚖️", desc: "", dmg: [30, 30], mp: 20, effect: "stun",
      quotes: { default: ["default shall"] },
    };
    const state = {
      engHp: 140, engMp: 70, conHp: 150, conMp: 60,
      engStatus: null, conStatus: null, log: [],
      engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
      engLastMove: null, conLastMove: "SUBMIT RFI",  // not a counter target
    };
    const attacker = { name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: 4 };
    const s = resolveMove(state, attacker, move, true, "SUBMIT RFI");
    const counterLine = s.log.find((e) => e.text.startsWith("⚔️ COUNTER"));
    expect(counterLine).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/__tests__/logic.test.js`
Expected: FAIL — no counter line emitted, counter multiplier not applied.

- [ ] **Step 3: Update `resolveMove` in `src/game/logic.js`**

Add the import at the top:

```js
import { isCounter as checkCounter, getCounterEntry } from "./counters.js";
```

Change `resolveMove` body (replace the damage calc and status-effect sections):

```js
export function resolveMove(state, attacker, move, isPlayer, opponentLastMove = null) {
  let s = { ...state };
  const attackerSide = isPlayer ? "engineer" : "contractor";
  const isOpening = isPlayer ? state.engLastMove == null : state.conLastMove == null;
  const isCounter = checkCounter(attackerSide, move.name, opponentLastMove);
  const quote = pickDialog({ attackerSide, move, opponentLastMove, isOpening });
  let newLog = [
    { text: `${attacker.name} uses ${move.emoji} ${move.name}!`, color: C.bright },
    { text: `  "${quote}"`, color: C.white },
  ];

  if (isCounter) {
    const entry = getCounterEntry(attackerSide, move.name, opponentLastMove);
    newLog.unshift({
      text: `⚔️ COUNTER! ${move.name} vs ${entry.initiator}`,
      color: C.yellow,
    });
  }

  if (isPlayer) { s.engMp = Math.max(0, s.engMp - move.mp); if (move.effect !== "heal") s.engFlash += 1; }
  else { s.conMp = Math.max(0, s.conMp - move.mp); if (move.effect !== "heal") s.conFlash += 1; }

  if (move.effect === "heal") {
    const heal = rand(GAME.healRange[0], GAME.healRange[1]);
    if (isPlayer) s.engHp = clamp(s.engHp + heal, 0, attacker.maxHp);
    else s.conHp = clamp(s.conHp + heal, 0, attacker.maxHp);
    newLog.push({ text: `  Recovered ${heal} HP!`, color: C.hpGreen });
    s.log = [...s.log, ...newLog];
    return s;
  }

  if (move.effect === "defense") {
    if (isPlayer) s.engStatus = STATUS.DEF_PLUS; else s.conStatus = STATUS.DEF_PLUS;
    newLog.push({ text: `  Defense raised!`, color: C.cyan });
  }

  const defenderStatus = isPlayer ? s.conStatus : s.engStatus;
  const { dmg, crit } = calculateDamage(move, defenderStatus, isCounter);

  if (isPlayer) { s.conHp = Math.max(0, s.conHp - dmg); s.conShake += 1; }
  else { s.engHp = Math.max(0, s.engHp - dmg); s.engShake += 1; }
  newLog.push({ text: `  ${crit ? "CRITICAL HIT! " : ""}${dmg} damage!`, color: crit ? C.yellow : C.red });

  const newStatus = rollStatusEffect(move, isCounter);
  if (newStatus) {
    if (isPlayer) s.conStatus = newStatus; else s.engStatus = newStatus;
    const statusMessages = {
      [STATUS.WEAKENED]: { text: `  Target's defense lowered!`, color: C.orange },
      [STATUS.STUNNED]: { text: `  Target is STUNNED!`, color: C.yellow },
      [STATUS.SLOWED]: { text: `  Target is SLOWED!`, color: C.orange },
    };
    newLog.push(statusMessages[newStatus]);
  }

  s.log = [...s.log, ...newLog];
  return s;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/__tests__/logic.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: `balance-regression` FAILS (counters now change sim results); all other tests pass.

- [ ] **Step 6: Commit (baseline still stale — intentionally)**

```bash
git add src/game/logic.js src/__tests__/logic.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): detect and apply canonical counters in resolveMove

resolveMove now checks counters.isCounter and threads isCounter
into calculateDamage + rollStatusEffect, and prepends a ⚔️ COUNTER
log line. balance-baseline.json is now stale — expected; will
regenerate after remaining wiring (Tasks 9-10) lands.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Track last-move in reducer state

**Files:**
- Modify: `src/game/reducer.js`
- Test: `src/__tests__/reducer.test.js`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/reducer.test.js`:

```js
describe("last-move tracking", () => {
  it("initState has null last-move fields", () => {
    const s = initState();
    expect(s.engLastMove).toBe(null);
    expect(s.conLastMove).toBe(null);
  });

  it("PLAYER_MOVE records engLastMove as the move name", () => {
    const state = { ...initState(), turn: "player" };
    const move = ENGINEER.moves[0]; // REJECT SUBMITTAL
    const s = reducer(state, { type: "PLAYER_MOVE", move });
    expect(s.engLastMove).toBe(move.name);
  });

  it("ENEMY_MOVE records conLastMove as the move name", () => {
    const state = { ...initState(), turn: "enemy" };
    const move = CONTRACTOR.moves[0]; // SUBMIT RFI
    const s = reducer(state, { type: "ENEMY_MOVE", move });
    expect(s.conLastMove).toBe(move.name);
  });

  it("RESET clears last-move fields", () => {
    const seeded = { ...initState(), engLastMove: "INVOKE SHALL", conLastMove: "SUBMIT RFI" };
    const s = reducer(seeded, { type: "RESET" });
    expect(s.engLastMove).toBe(null);
    expect(s.conLastMove).toBe(null);
  });

  it("PLAYER_STUNNED does NOT update engLastMove", () => {
    const state = {
      ...initState(), turn: "player", engStatus: STATUS.STUNNED,
      engLastMove: "CITE UFC",
    };
    const s = reducer(state, { type: "PLAYER_STUNNED" });
    expect(s.engLastMove).toBe("CITE UFC");
  });

  it("ENEMY_MOVE stun-skip branch does NOT update conLastMove", () => {
    const state = {
      ...initState(), turn: "enemy", conStatus: STATUS.STUNNED,
      conLastMove: "CLAIM DSC",
    };
    const s = reducer(state, { type: "ENEMY_MOVE" });
    expect(s.conLastMove).toBe("CLAIM DSC");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/__tests__/reducer.test.js`
Expected: FAIL — fields undefined.

- [ ] **Step 3: Update `src/game/reducer.js`**

Update `initState`:

```js
export const initState = () => ({
  engHp: ENGINEER.maxHp, engMp: ENGINEER.maxMp,
  conHp: CONTRACTOR.maxHp, conMp: CONTRACTOR.maxMp,
  engStatus: null, conStatus: null,
  engLastMove: null, conLastMove: null,
  log: [],
  turn: "intro", busy: false,
  engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
  winner: null,
});
```

In `PLAYER_MOVE` handler, after `let s = resolveMove(...)`, set the last move:

```js
    case "PLAYER_MOVE": {
      const move = action.move;
      if (state.turn !== "player" || state.busy) return state;
      if (state.engStatus === STATUS.STUNNED) return state;
      if (move.mp > state.engMp) {
        return { ...state, log: [...state.log, { text: "Not enough MP!", color: C.red }] };
      }
      let s = resolveMove(state, ENGINEER, move, true, state.conLastMove);
      s.engMp = clamp(s.engMp + ENGINEER.mpRegen, 0, ENGINEER.maxMp);
      s.engLastMove = move.name;
      if (s.conStatus === STATUS.DEF_PLUS) s.conStatus = null;
      const win = checkWinner(s, true);
      if (win) return win;
      return { ...s, turn: "enemy", busy: true };
    }
```

In `ENEMY_MOVE` handler (stun-skip branch stays unchanged — it returns without setting conLastMove, which is correct), add the `conLastMove` update after `resolveMove`:

```js
    case "ENEMY_MOVE": {
      if (state.turn !== "enemy") return state;
      if (state.conStatus === STATUS.STUNNED) {
        return {
          ...state, conStatus: null, turn: "player", busy: false,
          log: [...state.log, { text: "CONTRACTOR is stunned! Turn skipped!", color: C.yellow }],
        };
      }
      const move = action.move || pickAIMove(state);
      let s = resolveMove(state, CONTRACTOR, move, false, state.engLastMove);
      s.conMp = clamp(s.conMp + CONTRACTOR.mpRegen, 0, CONTRACTOR.maxMp);
      s.conLastMove = move.name;
      if (s.engStatus === STATUS.DEF_PLUS) s.engStatus = null;
      const win = checkWinner(s, false);
      if (win) return win;
      return { ...s, turn: "player", busy: false };
    }
```

(No explicit `RESET` handling needed — it already returns `initState()`.)

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/__tests__/reducer.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: `balance-regression` still FAILS (expected); all others pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/reducer.js src/__tests__/reducer.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): track engLastMove / conLastMove in reducer state

Last-move fields initialize null, update at the end of PLAYER_MOVE
and ENEMY_MOVE. Stunned-skip branches intentionally do NOT update
last-move (if you didn't act, you didn't signal anything
counter-able). RESET clears them via initState().

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Teach pickAIMove about counters

**Files:**
- Modify: `src/game/logic.js`
- Test: `src/__tests__/sim-policies.test.js` (or `src/__tests__/logic.test.js`)

- [ ] **Step 1: Write failing test**

Find the existing test file covering `pickAIMove`. It's likely in `logic.test.js` or `sim-policies.test.js`. Grep:

Run: `npx vitest run --reporter=verbose 2>&1 | grep -i pickaimove | head -20`

Append to the appropriate file a new describe block:

```js
describe("pickAIMove counter awareness", () => {
  it("returns the contractor counter when engineer's last move is a canonical initiator", () => {
    seedRng(1);  // seed chosen so Math.random() < 0.7 in first call
    const state = {
      engHp: 140, conHp: 150, engMp: 70, conMp: 60,
      engStatus: null, conStatus: null,
      engLastMove: "CITE UFC",  // CONTRACTOR counters with CLAIM DSC
      conLastMove: null,
    };
    const move = pickAIMove(state);
    expect(move.name).toBe("CLAIM DSC");
  });

  it("falls through to existing tiers when counter bias roll misses", () => {
    // Find a seed where Math.random() >= 0.7 on the first call.
    // Easier: call with a state that has no engLastMove.
    seedRng(1);
    const state = {
      engHp: 140, conHp: 150, engMp: 70, conMp: 60,
      engStatus: null, conStatus: null,
      engLastMove: null, conLastMove: null,
    };
    const move = pickAIMove(state);
    // Just asserting we get back a valid move from CONTRACTOR.moves
    expect(["SUBMIT RFI","CLAIM DSC","VALUE ENGINEER","SCHEDULE DELAY","OR-EQUAL GAMBIT","RESERVE RIGHTS"]).toContain(move.name);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run <wherever-you-added-it>`
Expected: FAIL — counter awareness not implemented.

- [ ] **Step 3: Update `pickAIMove` in `src/game/logic.js`**

Add import near the top (already have CONTRACTOR, add counters):

```js
import { COUNTER_ROUTING } from "./counters.js";
```

Replace the body of `pickAIMove`:

```js
export function pickAIMove(state) {
  // Counter bias — if engineer's last move opens a contractor counter and
  // we can afford it, play it with probability GAME.aiCounterBias.
  if (state.engLastMove) {
    const candidates = COUNTER_ROUTING
      .filter((e) => e.counterer === "contractor" && e.initiator === state.engLastMove)
      .map((e) => CONTRACTOR.moves.find((m) => m.name === e.counterMove))
      .filter((m) => m && m.mp <= state.conMp);
    if (candidates.length > 0 && random() < GAME.aiCounterBias) {
      return pick(candidates);
    }
  }
  // Heal if low
  if (state.conHp < 50 && state.conMp >= 15) return CONTRACTOR.moves[2]; // VALUE ENGINEER
  // Use Reserve Rights if weakened
  if (state.conStatus === STATUS.WEAKENED && state.conMp >= 8) return CONTRACTOR.moves[5];
  // Favor big attacks if engineer is low
  if (state.engHp < 40 && state.conMp >= 15) return CONTRACTOR.moves[1]; // CLAIM DSC
  // Weighted random from available
  const avail = CONTRACTOR.moves.filter(m => m.mp <= state.conMp && m.effect !== "heal");
  if (avail.length === 0) return CONTRACTOR.moves[0]; // fallback to RFI
  return pick(avail);
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run <test-file>`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: `balance-regression` still FAILS (expected); all others pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/logic.js src/__tests__/sim-policies.test.js src/__tests__/logic.test.js
git commit -m "$(cat <<'EOF'
feat(dialog): pickAIMove prefers canonical counters with aiCounterBias

When engineer's last move matches a canonical counter initiator
for the contractor side, pickAIMove plays the counter move with
probability GAME.aiCounterBias (default 0.7). Otherwise falls
through to existing heal/weakened/big-attack tiers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Migrate engineer quotes to object schema + seed counter content

**Files:**
- Modify: `content/quotes/engineer.json`

**Goal:** Convert all 6 engineer moves to the new object shape. Each move gets `default` (migrated from today's flat array) plus `vs_*` buckets for its canonical counter targets (at least 2 lines each). Other `vs_*` buckets can be empty — Task 16 fills them via authoring pipeline.

- [ ] **Step 1: Rewrite `content/quotes/engineer.json`**

Replace the whole file with:

```json
{
  "REJECT SUBMITTAL": {
    "default": [
      "This does not conform to the approved submittal.",
      "Disapproved. See red-lines attached.",
      "This is the third resubmittal. Still non-compliant.",
      "Did you even read the review comments?",
      "Revise and resubmit. Again.",
      "The cut sheet you submitted is for a different product.",
      "Submitting does not equal approved. The stamp says 'Revise and Resubmit.'",
      "Approval of submittals does not relieve the contractor from complying with all contract requirements.",
      "Your attention to this matter is appreciated."
    ],
    "vs_SUBMIT_RFI": [
      "Your 'clarification' RFI is a pre-approval attempt for non-conforming work. Disapproved.",
      "RFIs don't launder bad submittals. Code E."
    ]
  },
  "RED-LINE SPEC": {
    "default": [
      "See the red-lines attached. All 47 of them.",
      "I highlighted the non-conforming items. In red. The entire page is red.",
      "Remove and replace at no additional cost to the Government.",
      "Per the contract documents, this is unacceptable.",
      "The spec is clear and unambiguous on this point.",
      "As noted in our previous correspondence...",
      "The contractor bid this work. The time for questioning the spec was during bidding.",
      "The Government is concerned with the end result. If it doesn't meet spec, remove and replace at your expense."
    ],
    "vs_OR_EQUAL_GAMBIT": [
      "I red-lined every page of your 'or-equal' submission. The cut sheet alone is wrong on 12 points.",
      "Section 01 60 00 requires salient characteristics. Your proposed equal fails on thermal performance alone. Red-lined."
    ]
  },
  "INVOKE SHALL": {
    "default": [
      "The specification says SHALL. Not should. Not may. SHALL.",
      "SHALL is a mandatory obligation. There is no wiggle room.",
      "Shall means shall. I don't know how to make that clearer.",
      "This is contract compliance, not a suggestion box.",
      "Per Section 07 92 00, paragraph 3.2.1, the contractor SHALL apply sealant in strict accordance with manufacturer's written instructions.",
      "And yet here we are, contractually bound by it."
    ],
    "vs_OR_EQUAL_GAMBIT": [
      "The contractor SHALL furnish the specified product. 'Or equal' requires proven salient-characteristics equivalence. This isn't it.",
      "SHALL beats 'close enough.' The substitution fails the salient characteristics test. Denied.",
      "Section 01 60 00 is explicit: burden of proof for equivalence rests on the contractor. Not met."
    ],
    "vs_CLAIM_DSC": [
      "Per boring log B-4 referenced in Section 31 23 00, the contractor SHALL have anticipated these conditions. No Type I DSC.",
      "The contract SHALL-language defined what was foreseeable. Your DSC claim ignores the documents.",
      "SHALL means the contractor bore the subsurface risk at time of bid. Claim denied."
    ]
  },
  "ISSUE NCR": {
    "default": [
      "Noted. Non-conformance report filed.",
      "This NCR will be part of the permanent project record.",
      "Your QC system has failed to prevent this deficiency.",
      "The NCR is tagged and photographed. Enjoy your CPARS.",
      "We look forward to the Contractor's corrective action plan.",
      "This is the fourth NCR this month. See the trend?",
      "Items get physically marked on-site for maximum visibility. Your crew will see this every morning.",
      "We will memorialize this discussion in the meeting minutes."
    ],
    "vs_VALUE_ENGINEER": [
      "Your VECP proposes a cheaper version of work we've just NCR'd. The underlying installation is non-conforming. VECP rejected, NCR stands.",
      "Value engineering cannot relieve you from complying with the existing contract. And your current work doesn't. NCR filed.",
      "No VECP on non-conforming work. You don't get to renegotiate your way out of the NCR."
    ]
  },
  "CITE UFC": {
    "default": [
      "Per UFC 1-200-01, this is mandatory for all DoD construction.",
      "The UFC is not optional. It is not a guideline. It is the standard.",
      "We're not building a piano. We're building a military facility to UFC standards.",
      "The Government did not specify the minimum. The Government specified the standard.",
      "Approval does not relieve the contractor from complying with all contract requirements.",
      "UFC and UFGS are mandatory for all DoD construction. This is the engineer's divine authority."
    ],
    "vs_SUBMIT_RFI": [
      "Your RFI is answered by UFC 3-600-01, paragraph 2-3.1. The requirement is mandatory, not ambiguous.",
      "The answer to your RFI has been in the UFC since 2016. Read it.",
      "UFC resolves your RFI. There is no design intent to clarify — the criteria are explicit."
    ]
  },
  "CURE NOTICE": {
    "default": [
      "You have 10 days to cure this deficiency or face default termination.",
      "Show cause why this contract should not be terminated for default.",
      "Failure to present an explanation may be taken as admission that none exists.",
      "This matter is referred to the Contracting Officer for final decision.",
      "Please be advised...",
      "This is the engineer calling in an airstrike."
    ],
    "vs_SCHEDULE_DELAY": [
      "Your schedule narrative attributes delays to weather, RFIs, and tides. Our analysis shows the delays are contractor-caused. Cure notice issued.",
      "Concurrent delay doctrine doesn't save you when the critical-path driver is your own late submittals. 10 days."
    ]
  }
}
```

**Counter pairings seeded (engineer side):** `vs_OR_EQUAL_GAMBIT` on INVOKE SHALL and RED-LINE SPEC; `vs_CLAIM_DSC` on INVOKE SHALL; `vs_VALUE_ENGINEER` on ISSUE NCR; `vs_SCHEDULE_DELAY` on CURE NOTICE; `vs_SUBMIT_RFI` on CITE UFC and REJECT SUBMITTAL. That's 7 buckets covering all 7 engineer-side canonical counters.

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: content-integrity tests pass (new shape validated); content-loader tests pass (shape normalizes correctly); `balance-regression` still FAILS (expected, will fix at Task 17).

- [ ] **Step 3: Commit**

```bash
git add content/quotes/engineer.json
git commit -m "$(cat <<'EOF'
content(dialog): migrate engineer quotes to object schema + counter seeds

Every move has default + vs_* buckets for its canonical counter
targets (7 buckets across 6 moves, 2-3 lines each). Default pools
preserve existing flat-array content. Remaining vs_* buckets for
non-counter context pairs will be authored via pipeline (Task 16).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Migrate contractor quotes to object schema + seed counter content

**Files:**
- Modify: `content/quotes/contractor.json`

- [ ] **Step 1: Rewrite `content/quotes/contractor.json`**

```json
{
  "SUBMIT RFI": {
    "default": [
      "The specifications appear to conflict between Section 3.2 and Drawing C-401...",
      "Please clarify the design intent regarding...",
      "Failure to respond within 10 days will impact the critical path.",
      "We have submitted 47 RFIs this week. Your response is overdue on 38 of them.",
      "The answer may be in the documents, but we'd like it in writing from you.",
      "This RFI is submitted without prejudice to the Contractor's right to claim delay.",
      "There were 4,000 RFIs on this project. Clearly the design was incomplete.",
      "Please advise whether the contractor should proceed with Option A or Option B..."
    ],
    "vs_INVOKE_SHALL": [
      "The specification says SHALL apply sealant. SHALL what, exactly? Per ASTM C920 or C1193? This RFI is submitted for clarification.",
      "You invoked SHALL but the design intent is ambiguous. RFI submitted without prejudice to critical-path claims."
    ]
  },
  "CLAIM DSC": {
    "default": [
      "Pursuant to FAR 52.236-2, we are providing prompt written notice...",
      "The boring logs did not indicate this condition.",
      "This rock was not reasonably foreseeable from the contract documents.",
      "We consider this a Type I Differing Site Condition.",
      "We stopped work immediately and preserved the evidence. Our photographer was here before the dust settled.",
      "The Government's mere silence is insufficient to establish the absence of unfavorable conditions.",
      "We stopped work immediately, photographed everything, and fired off the magic letter."
    ],
    "vs_CITE_UFC": [
      "UFC 3-220-01 governs above-ground design. It doesn't speak to the subsurface conditions we encountered. This is DSC territory.",
      "You cited UFC. The UFC is silent on the boulder field we just hit. FAR 52.236-2 notice filed."
    ]
  },
  "VALUE ENGINEER": {
    "default": [
      "We've identified significant savings through an alternative approach...",
      "This VECP maintains performance while reducing cost by 40%.",
      "Under FAR 52.248-3, the contractor retains 55% of net savings.",
      "We bid the expensive product. Now here's a cheaper one. You're welcome.",
      "It meets the MINIMUM requirements. That's what minimum means.",
      "We identified the cheaper alternative during estimating, bid the expensive item, then submitted the VECP. Standard procedure.",
      "USACE acceptance rate for VECPs has historically exceeded 60%. We like those odds."
    ],
    "vs_REJECT_SUBMITTAL": [
      "You rejected our submittal. Fine. Here's a VECP with a cheaper product that still meets performance. 55% split.",
      "Rather than resubmit, we propose a value engineering change proposal. Same function, lower cost, mutual savings."
    ]
  },
  "SCHEDULE DELAY": {
    "default": [
      "The updated CPM shows 47 government-caused delays on the critical path.",
      "Your RFI response consumed the remaining float on Activity 340.",
      "We cannot determine at this time the full effect on the completion date...",
      "Month 1: on schedule. Month 3: minor weather delay. Month 6: 47 RFIs on the critical path. Month 9: the schedule narrative reads like a legal brief.",
      "Who owns the float? We do. Obviously.",
      "Blame weather, supply chain, the tides, and your RFI response time."
    ],
    "vs_ISSUE_NCR": [
      "Your NCR required rework that consumed 12 days of float on Activity 420. CPM update attached.",
      "The NCR drove the rebar resequencing, which drove the critical-path slip. Time extension requested."
    ]
  },
  "OR-EQUAL GAMBIT": {
    "default": [
      "We believe this product is an approved equal per Section 01 60 00.",
      "Other engineers have let us substitute this on every other project.",
      "The base approved this for Building 101 - why not here?",
      "It meets intent. Close enough.",
      "Our sub says it meets spec. Their rep confirmed it. Verbally. Probably.",
      "Nobody installs the specified product anymore. It's obsolete.",
      "Any vehicle that runs may be acceptable. That makes every vehicle equal to a Cadillac, right?",
      "Those loopholes and post-award substitution acceptance were what made me money on the contracting side."
    ],
    "vs_RED_LINE_SPEC": [
      "You red-lined the specified product. Our or-equal meets all salient characteristics per 01 60 00.",
      "Red-lines don't preclude an approved equal. Our substitution documentation is attached and complete."
    ]
  },
  "RESERVE RIGHTS": {
    "default": [
      "We reserve all rights under the contract.",
      "This work is performed under protest and with full reservation of rights.",
      "We consider this direction to be a constructive change.",
      "Please confirm this direction in writing from the Contracting Officer.",
      "Only the Contracting Officer can bind the Government. You're the COR.",
      "Have you been keeping daily logs? Good. They're evidence now.",
      "This is not within our scope of work as defined by the contract documents.",
      "Before we begin, let me note that this meeting does not constitute a waiver of any rights under the contract.",
      "We assure you that we will do everything we can to minimize those costs..."
    ],
    "vs_CURE_NOTICE": [
      "We dispute the cure notice. Performance will continue under protest with full reservation of rights for all impacts.",
      "The cure notice is predicated on contested facts. We reserve all rights, including appeal to the Board of Contract Appeals."
    ]
  }
}
```

**Counter pairings seeded (contractor side):** `vs_INVOKE_SHALL` on SUBMIT RFI; `vs_CITE_UFC` on CLAIM DSC; `vs_REJECT_SUBMITTAL` on VALUE ENGINEER; `vs_ISSUE_NCR` on SCHEDULE DELAY; `vs_RED_LINE_SPEC` on OR-EQUAL GAMBIT; `vs_CURE_NOTICE` on RESERVE RIGHTS. 6 buckets covering all 6 contractor-side canonical counters.

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: content-integrity + content-loader pass; `balance-regression` still FAILS.

- [ ] **Step 3: Commit**

```bash
git add content/quotes/contractor.json
git commit -m "$(cat <<'EOF'
content(dialog): migrate contractor quotes to object schema + counter seeds

Every move has default + vs_* buckets for its canonical counter
targets (6 buckets across 6 moves, 2 lines each). Remaining
non-counter vs_* context pools authored via pipeline in Task 16.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: End-to-end dialog integration tests

**Files:**
- Create: `src/__tests__/dialog-integration.test.js`

**Goal:** One test per canonical counter — 13 total — that drives the reducer through initiator → counter and asserts the full payoff (bonus damage, guaranteed status, ⚔️ log line, vs_* quote sourcing).

- [ ] **Step 1: Create the file**

```js
import { describe, it, expect, beforeEach } from "vitest";
import { reducer, initState } from "../game/reducer.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { COUNTER_ROUTING } from "../game/counters.js";
import { STATUS, GAME } from "../constants.js";
import { seed } from "../game/rng.js";

function moveByName(character, name) {
  return character.moves.find((m) => m.name === name);
}

function playCounter({ initiator, counterer, counterMove }) {
  seed(1);
  // Set up state where the opponent has "just played" the initiator — we
  // drive this by seeding state.{con|eng}LastMove rather than actually playing
  // the previous turn, to keep test state minimal.
  const base = initState();
  if (counterer === "engineer") {
    const mv = moveByName(ENGINEER, counterMove);
    const state = { ...base, turn: "player", conLastMove: initiator, engMp: 100 };
    return { state, action: { type: "PLAYER_MOVE", move: mv }, counterMove: mv };
  } else {
    const mv = moveByName(CONTRACTOR, counterMove);
    const state = { ...base, turn: "enemy", engLastMove: initiator, conMp: 100 };
    return { state, action: { type: "ENEMY_MOVE", move: mv }, counterMove: mv };
  }
}

describe("canonical counter integration", () => {
  COUNTER_ROUTING.forEach((entry) => {
    const label = `${entry.counterer} counters '${entry.initiator}' with '${entry.counterMove}'`;
    describe(label, () => {
      it("emits ⚔️ COUNTER log line", () => {
        const { state, action } = playCounter(entry);
        const s = reducer(state, action);
        const line = s.log.find((e) => e.text.startsWith("⚔️ COUNTER"));
        expect(line, `missing counter line for ${label}`).toBeDefined();
        expect(line.text).toContain(entry.counterMove);
        expect(line.text).toContain(entry.initiator);
      });

      it("applies counter damage multiplier (dmg ≥ Math.floor(base.min × counterMultiplier))", () => {
        const { state, action, counterMove } = playCounter(entry);
        const s = reducer(state, action);
        const dmgLine = s.log.find((e) => e.text.match(/damage!/));
        expect(dmgLine).toBeDefined();
        const dmg = parseInt(dmgLine.text.match(/(\d+) damage/)[1], 10);
        expect(dmg).toBeGreaterThanOrEqual(Math.floor(counterMove.dmg[0] * GAME.counterMultiplier));
      });

      it("guarantees status when the counter move has stun/slow/weaken", () => {
        const { state, action, counterMove } = playCounter(entry);
        const s = reducer(state, action);
        if (counterMove.effect === "stun") {
          if (entry.counterer === "engineer") expect(s.conStatus).toBe(STATUS.STUNNED);
          else expect(s.engStatus).toBe(STATUS.STUNNED);
        } else if (counterMove.effect === "slow") {
          if (entry.counterer === "engineer") expect(s.conStatus).toBe(STATUS.SLOWED);
          else expect(s.engStatus).toBe(STATUS.SLOWED);
        } else if (counterMove.effect === "weaken") {
          if (entry.counterer === "engineer") expect(s.conStatus).toBe(STATUS.WEAKENED);
          else expect(s.engStatus).toBe(STATUS.WEAKENED);
        }
      });

      it("sources quote from the vs_* bucket (seed content from Tasks 11-12 required)", () => {
        const { state, action, counterMove } = playCounter(entry);
        const s = reducer(state, action);
        const vsKeyForMove = "vs_" + entry.initiator.replace(/[ -]/g, "_");
        const expectedLines = counterMove.quotes[vsKeyForMove] || [];
        expect(expectedLines.length, `seed content missing at ${counterMove.name}.${vsKeyForMove}`).toBeGreaterThan(0);
        const quoteLine = s.log.find((e) => e.text.startsWith("  \""));
        expect(quoteLine).toBeDefined();
        const matched = expectedLines.some((line) => quoteLine.text.includes(line));
        expect(matched, `quote line '${quoteLine.text}' not from ${vsKeyForMove}`).toBe(true);
      });
    });
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npx vitest run src/__tests__/dialog-integration.test.js`
Expected: All 52 assertions (13 counters × 4 aspects) PASS.

If any fail on the quote-bucket assertion, re-check that the corresponding `vs_*` bucket has ≥1 line in `content/quotes/*.json`.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: `balance-regression` still FAILS (expected, Task 17 fixes); everything else passes.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/dialog-integration.test.js
git commit -m "$(cat <<'EOF'
test(dialog): end-to-end integration tests for 13 canonical counters

Drives reducer through initiator → counter for each canonical
pairing. Asserts ⚔️ COUNTER log, counter damage floor, guaranteed
status per effect type, and quote sourced from the correct vs_*
bucket using seed content from Tasks 11-12.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Create authoring pipeline scaffolding

**Files:**
- Create: `scripts/dialog-author/research.js`
- Create: `scripts/dialog-author/roleplay.js`
- Create: `scripts/dialog-author/mine.js`
- Create: `scripts/dialog-author/coverage.js`
- Modify: `.gitignore`

**Goal:** Runnable scripts for Stages 1-3 of the authoring pipeline plus a coverage-report tool. Each script is self-contained, invokable via `node scripts/dialog-author/<name>.js`, and uses the `src/tune/claudeTransport.js` pattern to call the Claude CLI.

- [ ] **Step 1: Add `scratch/` and outputs to `.gitignore`**

Append to `.gitignore`:

```
# Dialog authoring scratch
scratch/
```

- [ ] **Step 2: Create the coverage script**

Create `scripts/dialog-author/coverage.js`:

```js
#!/usr/bin/env node
// Report which vs_* buckets in content/quotes/*.json are missing or thin.
// Usage: node scripts/dialog-author/coverage.js [--min=2]

import fs from "node:fs";
import path from "node:path";

const MIN = Number((process.argv.find((a) => a.startsWith("--min=")) || "--min=2").split("=")[1]);

const engineerMoves = JSON.parse(fs.readFileSync("content/moves/engineer.json", "utf8"));
const contractorMoves = JSON.parse(fs.readFileSync("content/moves/contractor.json", "utf8"));
const engineerQuotes = JSON.parse(fs.readFileSync("content/quotes/engineer.json", "utf8"));
const contractorQuotes = JSON.parse(fs.readFileSync("content/quotes/contractor.json", "utf8"));

function vsKey(n) { return "vs_" + n.replace(/[ -]/g, "_"); }

function report(label, ourMoves, theirMoves, quotes) {
  const missing = [];
  const thin = [];
  ourMoves.forEach((m) => {
    theirMoves.forEach((t) => {
      const key = vsKey(t.name);
      const pool = (quotes[m.name] && quotes[m.name][key]) || [];
      if (pool.length === 0) missing.push(`${m.name}.${key}`);
      else if (pool.length < MIN) thin.push(`${m.name}.${key} (${pool.length}/${MIN})`);
    });
  });
  const total = ourMoves.length * theirMoves.length;
  const populated = total - missing.length;
  console.log(`\n=== ${label} coverage: ${populated}/${total} buckets (min ${MIN}) ===`);
  if (thin.length) console.log(`Thin buckets:\n  ${thin.join("\n  ")}`);
  if (missing.length) console.log(`Missing buckets:\n  ${missing.join("\n  ")}`);
  return { populated, total, missing, thin };
}

const e = report("Engineer", engineerMoves, contractorMoves, engineerQuotes);
const c = report("Contractor", contractorMoves, engineerMoves, contractorQuotes);

console.log(`\nTotals: ${e.populated + c.populated}/${e.total + c.total} populated`);
```

- [ ] **Step 3: Run coverage script to verify it works**

Run: `node scripts/dialog-author/coverage.js`
Expected output: roughly 7/36 engineer buckets populated, 6/36 contractor buckets. Confirms canonical counter seed content is there, rest is blank.

- [ ] **Step 4: Create the research script**

Create `scripts/dialog-author/research.js`:

```js
#!/usr/bin/env node
// Stage 1 — call Claude CLI to produce a NAVFAC-domain source material doc
// that subsequent role-play sessions use as context. Output is committed to
// docs/dialog-source-material.md for human review/edit before role-play runs.
//
// Usage: node scripts/dialog-author/research.js [--out=docs/dialog-source-material.md]

import fs from "node:fs";
import path from "node:path";
import { createCliTransport } from "../../src/tune/claudeTransport.js";

const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "--out=docs/dialog-source-material.md").split("=")[1];

const prompt = `You are helping author dialog for SPEC BATTLE RPG — a turn-based game
between a NAVFAC federal construction ENGINEER and a CONTRACTOR that draws on real
FAR clauses, UFC/UFGS references, and CMAA industry research.

Produce a Markdown reference document of NAVFAC/FAR adversarial exchanges organized
by the game's 12 moves (6 per character):

ENGINEER MOVES: REJECT SUBMITTAL, RED-LINE SPEC, INVOKE SHALL, ISSUE NCR, CITE UFC, CURE NOTICE
CONTRACTOR MOVES: SUBMIT RFI, CLAIM DSC, VALUE ENGINEER, SCHEDULE DELAY, OR-EQUAL GAMBIT, RESERVE RIGHTS

For EACH move, document:
- What it is in real federal construction (1-2 sentences)
- The canonical FAR/UFC/UFGS references that back it up
- 3-5 "dialog hooks" — short phrases or rhetorical patterns an in-character NAVFAC
  engineer or contractor PM would actually say when playing this move
- For each potential opposing move, a 1-2 sentence note on HOW the move functions
  as a rebuttal (e.g., "OR-EQUAL GAMBIT vs RED-LINE SPEC: contractor frames red-lines
  as preclusive; responds with salient-characteristics argument under Section 01 60 00")

This document becomes the knowledge base for agent role-play sessions that generate
game dialog. Prioritize accuracy to real NAVFAC practice, humor that insiders will
recognize, and specificity (clause numbers, section numbers, realistic PM vocabulary).

Respond with the Markdown body only — no preamble, no code fences.`;

const transport = createCliTransport({
  model: process.env.TUNE_MODEL || "claude-sonnet-4-6",
  timeoutMs: Number(process.env.TUNE_TIMEOUT_MS || 180000),
});

const raw = transport.send(prompt);
const parsed = JSON.parse(raw);
const body = typeof parsed === "string" ? parsed : (parsed.result || parsed.content || JSON.stringify(parsed));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`Wrote ${OUT} (${body.length} chars)`);
```

Note: This mirrors the structure of `src/tune/claudeTransport.js`. If the transport's actual output-shape differs (e.g., it returns `result` already-unwrapped), adjust the `const body = ...` line to match — read `src/tune/claudeTransport.js` for the exact shape.

- [ ] **Step 5: Create the roleplay script**

Create `scripts/dialog-author/roleplay.js`:

```js
#!/usr/bin/env node
// Stage 2 — run one role-play session between engineer and contractor personas.
// Output: scratch/dialog-transcripts/session-<timestamp>.json.
//
// Usage: node scripts/dialog-author/roleplay.js [--turns=8] [--starter=contractor]

import fs from "node:fs";
import path from "node:path";
import { createCliTransport } from "../../src/tune/claudeTransport.js";

const TURNS = Number((process.argv.find((a) => a.startsWith("--turns=")) || "--turns=8").split("=")[1]);
const STARTER = (process.argv.find((a) => a.startsWith("--starter=")) || "--starter=contractor").split("=")[1];

const sourceDoc = fs.existsSync("docs/dialog-source-material.md")
  ? fs.readFileSync("docs/dialog-source-material.md", "utf8")
  : "(source material doc not present — run research.js first)";

const prompt = `You will role-play a ${TURNS}-turn exchange between two characters in
SPEC BATTLE RPG, starting with the ${STARTER.toUpperCase()}.

ENGINEER (NAVFAC): grizzled federal construction engineer with 30 years of experience,
a stack of NCRs, and zero patience for contractor games. Talks in terms of contract
language, UFC/UFGS clauses, and submittal discipline.

CONTRACTOR (PM): slick construction project manager with paper-trail instincts,
strategic RFI submission, and a talent for framing every engineer decision as a
constructive change or differing site condition.

Each turn, the speaker picks ONE of their 6 moves and delivers ONE in-character line
of dialog specific to the prior turn's move. Moves available:

ENGINEER: REJECT SUBMITTAL, RED-LINE SPEC, INVOKE SHALL, ISSUE NCR, CITE UFC, CURE NOTICE
CONTRACTOR: SUBMIT RFI, CLAIM DSC, VALUE ENGINEER, SCHEDULE DELAY, OR-EQUAL GAMBIT, RESERVE RIGHTS

Source material (NAVFAC/FAR reference):
---
${sourceDoc.slice(0, 8000)}
---

Output a JSON array of objects: [{ turn: 1, speaker: "contractor", move: "SUBMIT RFI",
priorMove: null, line: "..." }, ...]. No preamble, no fences, JSON only.`;

const transport = createCliTransport({
  model: process.env.TUNE_MODEL || "claude-sonnet-4-6",
  timeoutMs: Number(process.env.TUNE_TIMEOUT_MS || 180000),
});

const raw = transport.send(prompt);
const parsed = JSON.parse(raw);
const text = typeof parsed === "string" ? parsed : (parsed.result || parsed.content || "");
// Strip any accidental code fences
const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
const transcript = JSON.parse(cleaned);

fs.mkdirSync("scratch/dialog-transcripts", { recursive: true });
const outPath = `scratch/dialog-transcripts/session-${Date.now()}.json`;
fs.writeFileSync(outPath, JSON.stringify(transcript, null, 2));
console.log(`Wrote ${outPath} (${transcript.length} turns)`);
```

- [ ] **Step 6: Create the mine script**

Create `scripts/dialog-author/mine.js`:

```js
#!/usr/bin/env node
// Stage 3 — aggregate transcripts in scratch/dialog-transcripts/, bucket lines
// by (speaker_move, priorMove), dedup near-matches, emit candidate pool.
//
// Output: scratch/dialog-candidates.json, indexed as
//   { engineer: { REJECT_SUBMITTAL: { default: [...], vs_SUBMIT_RFI: [...] }, ... },
//     contractor: { ... } }
//
// Usage: node scripts/dialog-author/mine.js

import fs from "node:fs";
import path from "node:path";

const DIR = "scratch/dialog-transcripts";
if (!fs.existsSync(DIR)) {
  console.error(`${DIR} does not exist — run roleplay.js first`);
  process.exit(1);
}

const candidates = { engineer: {}, contractor: {} };
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
console.log(`Mining ${files.length} transcripts...`);

function vsKey(n) { return "vs_" + n.replace(/[ -]/g, "_"); }
function bucketKey(priorMove) {
  return priorMove ? vsKey(priorMove) : "default";
}

for (const f of files) {
  const transcript = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  for (const turn of transcript) {
    if (!turn.speaker || !turn.move || !turn.line) continue;
    const side = turn.speaker;
    const move = turn.move;
    const key = bucketKey(turn.priorMove);
    candidates[side][move] = candidates[side][move] || {};
    candidates[side][move][key] = candidates[side][move][key] || [];
    if (!candidates[side][move][key].includes(turn.line)) {
      candidates[side][move][key].push(turn.line);
    }
  }
}

fs.writeFileSync("scratch/dialog-candidates.json", JSON.stringify(candidates, null, 2));
console.log("Wrote scratch/dialog-candidates.json");
```

- [ ] **Step 7: Confirm scripts don't break the build**

Run: `npm test`
Expected: all non-regression tests pass; `balance-regression` still fails (until Task 17).

Run: `node scripts/dialog-author/coverage.js`
Expected: coverage report prints without errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/dialog-author/ .gitignore
git commit -m "$(cat <<'EOF'
feat(dialog): authoring pipeline scaffolding (research/roleplay/mine/coverage)

Four scripts under scripts/dialog-author/ covering the four-stage
content pipeline. research.js + roleplay.js call Claude CLI via
the existing src/tune/claudeTransport.js pattern. mine.js aggregates
transcripts into candidate pools. coverage.js reports bucket
populate state. Pipeline is dev-time only — no runtime LLM.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Run Stage 1 — produce source material doc

**Files:**
- Create: `docs/dialog-source-material.md` (produced by script)

- [ ] **Step 1: Run research.js**

Run: `node scripts/dialog-author/research.js`
Expected: writes `docs/dialog-source-material.md`. Script may take 30-90 seconds (Claude CLI call).

If it fails with `claude` not found, set `TUNE_CLAUDE_BIN` to the claude binary path (see CLAUDE.md "Tuning harness — LLM proposer" section for details).

- [ ] **Step 2: Human review of the generated doc**

Open `docs/dialog-source-material.md`. Read it top-to-bottom. Check:
- FAR clause numbers are real (52.236-2 for DSC, 52.248-3 for VE — compare against a FAR reference)
- UFC/UFGS references are plausible
- Dialog hooks sound like real PMs, not corporate copy
- Nothing libelous or wildly wrong

Edit inline to correct errors. The curated doc becomes the grounding context for role-play sessions in Task 16.

- [ ] **Step 3: Commit the curated doc**

```bash
git add docs/dialog-source-material.md
git commit -m "$(cat <<'EOF'
docs(dialog): source material reference for authoring pipeline

NAVFAC/FAR adversarial-exchange reference doc produced by
scripts/dialog-author/research.js and curated by hand. Grounding
context for role-play sessions in Task 16.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Bulk content authoring — execute pipeline until coverage gate met

**Goal:** Populate at least 30 of 36 `vs_*` buckets per side (plus `opening` per move) with ≥2 curated lines each. This is a sustained, iterative human+agent effort, NOT a single run.

**This task is gated.** Complete all prior tasks first — `npm test` should be green for everything EXCEPT `balance-regression`.

- [ ] **Step 1: Run a role-play session**

Run: `node scripts/dialog-author/roleplay.js --turns=12 --starter=contractor`
Expected: produces one transcript under `scratch/dialog-transcripts/`.

- [ ] **Step 2: Run mining**

Run: `node scripts/dialog-author/mine.js`
Expected: produces/updates `scratch/dialog-candidates.json`.

- [ ] **Step 3: Human curation pass**

Open `scratch/dialog-candidates.json`. For each bucket with candidate lines:
- Cut generic or low-voice lines
- Fix factual errors (wrong clause numbers, misremembered UFC sections)
- Tighten voice — engineer should sound clinical and exasperated; contractor should sound strategic and faux-helpful
- Copy curated lines into the appropriate `content/quotes/*.json` object

Each `vs_*` bucket needs ≥2 lines to pass content-integrity. `opening` buckets are optional but desirable.

- [ ] **Step 4: Check coverage**

Run: `node scripts/dialog-author/coverage.js`
Expected: incremental progress. Target: ≥30 populated buckets per side out of 36.

- [ ] **Step 5: Run content-integrity test**

Run: `npx vitest run src/__tests__/content-integrity.test.js`
Expected: PASS (schema + min-line rules hold).

- [ ] **Step 6: Repeat Steps 1-5 until coverage gate met**

**This loop typically runs 20-40 iterations over extended time.** Vary `--starter` and `--turns` across runs to exercise different opening contexts. Target different thin buckets by mentally framing the starter/move when running `roleplay.js`.

- [ ] **Step 7: Periodic commits during the loop**

After every 5-10 new buckets populated, commit. Use a descriptive message: e.g., `content(dialog): fill 8 new vs_* buckets on engineer side`.

```bash
git add content/quotes/engineer.json content/quotes/contractor.json
git commit -m "$(cat <<'EOF'
content(dialog): authored N context buckets from role-play sessions

From role-play transcripts + human curation. Bucket coverage now
X/36 engineer + Y/36 contractor.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Final coverage check + commit**

Once `node scripts/dialog-author/coverage.js` reports ≥30/36 per side:

Run: `npm test`
Expected: all tests except `balance-regression` pass.

```bash
git add content/quotes/engineer.json content/quotes/contractor.json
git commit -m "$(cat <<'EOF'
content(dialog): coverage gate reached (≥30/36 vs_* buckets per side)

Coverage ready for D1 ship. Content was generated via 20-40
role-play sessions + human curation. balance-baseline.json
regen is next (Task 17).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Note on handback:** if the implementer is not the person doing curation (which is the likely case for agentic execution), they should stop at Task 15 completion and ask the user whether to continue. Task 16 is long-running human authorship work and should not be automated past the script runs.

---

## Task 17: Regenerate balance baseline

**Files:**
- Modify: `balance-baseline.json`

- [ ] **Step 1: Confirm pre-conditions**

Run: `npm test`
Expected: all tests pass EXCEPT `balance-regression`. If any other tests fail, go back and fix before regenerating.

- [ ] **Step 2: Snapshot the current (stale) baseline for diffing**

Run: `cp balance-baseline.json /tmp/balance-baseline.before.json`

- [ ] **Step 3: Regenerate**

Run: `npm run sim:update-baseline`
Expected: rewrites `balance-baseline.json`. Takes ~10-30 seconds.

- [ ] **Step 4: Review the diff**

Run: `git diff balance-baseline.json`

Verify expected directional shifts:
- `engineer` (or equivalent) win rate in Random-vs-AI matchup: moves UP a few percentage points (engineer-player benefits from canonical-counter bonuses)
- Per-move frequency for counter moves (INVOKE SHALL, ISSUE NCR, CURE NOTICE, CITE UFC, RED-LINE SPEC, REJECT SUBMITTAL on engineer side; CLAIM DSC, RESERVE RIGHTS, SCHEDULE DELAY, SUBMIT RFI, VALUE ENGINEER, OR-EQUAL GAMBIT on contractor side): some will trend up
- Random-vs-Random matchup: slight shift (counters only fire on matching (initiator, counter) pairs which are still random-chance)

If the shift looks wrong (e.g., contractor win rate unexpectedly up by 15pp, or per-move frequencies flat), something is miswired — investigate.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: ALL tests pass, including `balance-regression`.

- [ ] **Step 6: Commit with rationale**

```bash
git add balance-baseline.json
git commit -m "$(cat <<'EOF'
chore(baseline): regenerate for D1 counter mechanics

Expected shifts driven by Tasks 7-10 counter-routing:
- Engineer (player side) win rate in Random-vs-AI matchup: up ~X pp
- Per-move frequencies: counter moves (INVOKE SHALL, ISSUE NCR,
  CURE NOTICE on engineer; RESERVE RIGHTS, CLAIM DSC on contractor)
  trend upward
- Random-vs-Random matchup: modest shift (counters still
  condition on matching initiator/counter pairs)

Manual review of diff against /tmp/balance-baseline.before.json
confirmed directional correctness.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `~X pp` with the actual shift observed in Step 4.)

---

## Task 18: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Dialog system" section**

Find the "Game Mechanics" section in `CLAUDE.md`. After it (or alongside it), add:

```markdown
## Dialog system

Runtime dialog is context-aware. Each `move.quotes` object has three kinds of bucket:
- `default` (required) — fallback quote pool.
- `opening` (optional) — used on a character's first move of the game (their `*LastMove` is still null).
- `vs_<OPPONENT_MOVE>` (optional, spaces and hyphens → underscores, case preserved) — used when the opponent's last move matches.

`src/game/dialog.js` exports `pickDialog({ attackerSide, move, opponentLastMove, isOpening })` which resolves the priority `opening > vs_<opponent> > default`. Content-loader normalizes legacy flat-array shape to `{ default: [...] }` on load.

### Canonical counter pairings

`src/game/counters.js` exports `COUNTER_ROUTING` — 13 `(initiator, counterer, counterMove)` triples. When `isCounter()` matches during `resolveMove`:
- `calculateDamage` multiplies by `GAME.counterMultiplier` (default 1.3) before crit / defender status.
- `rollStatusEffect` bypasses the random roll and guarantees the move's stun/slow/weaken status (no-op for heal/defense/null).
- A `⚔️ COUNTER!` log line is prepended.
- The dialog selected is pulled from the `vs_<initiator>` bucket.

Reducer state carries `engLastMove` and `conLastMove` (both `string | null`, cleared by RESET). Stunned-skip branches intentionally do NOT update these — if you didn't act, you don't open a counter window.

`pickAIMove` includes a top-priority counter rule: if `engLastMove` matches a canonical initiator for the contractor side AND contractor can afford the counter move's MP, play it with probability `GAME.aiCounterBias` (default 0.7).

### Authoring pipeline

Dev-time only, under `scripts/dialog-author/`:
- `research.js` → produces `docs/dialog-source-material.md` (committed).
- `roleplay.js` → one multi-turn in-character session → `scratch/dialog-transcripts/session-<ts>.json` (gitignored).
- `mine.js` → aggregates transcripts → `scratch/dialog-candidates.json` (gitignored).
- Human curation → curated lines moved into `content/quotes/*.json`.
- `coverage.js` → reports `vs_*` bucket populate state. Use to target thin areas in subsequent role-play runs.

All four scripts use `src/tune/claudeTransport.js` for Claude CLI calls. `TUNE_CLAUDE_BIN` / `TUNE_MODEL` / `TUNE_TIMEOUT_MS` env vars apply the same way as for the tuning harness. No runtime LLM — the curated static JSON is the shipping artifact.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): document dialog system + authoring pipeline

New CLAUDE.md section covers runtime dialog (bucket priority,
counter mechanics, AI counter bias, stunned last-move call) and
the four-stage dev-time authoring pipeline.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Manual QA playthrough

**Goal:** Confirm the feature plays as intended before declaring D1 done.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open: `http://localhost:5173`

- [ ] **Step 2: Play 5 games end-to-end**

In each game, deliberately attempt at least 2 canonical counters (e.g., play INVOKE SHALL immediately after the contractor plays OR-EQUAL GAMBIT). Verify:

- The ⚔️ COUNTER log line appears exactly when expected (matching (initiator, counter) pair on adjacent turns).
- The damage on counter turns is visibly higher than baseline (eyeball check — exact numbers vary due to crit roll).
- When the counter move has stun or slow, the opponent is visibly stunned/slowed every single time on a counter.
- The quote that appears on a counter turn is specifically relevant to the initiator (not a generic default line).
- Non-counter turns still show sensible, contextual dialog when the opponent's last move matches a populated `vs_*` bucket.

If any of these fail the eye test, investigate the specific scenario in tests first.

- [ ] **Step 3: Stop the dev server**

Ctrl+C.

- [ ] **Step 4: Final test run**

Run: `npm test`
Expected: ALL 275+ tests pass (existing + new).

- [ ] **Step 5: Confirm tune pipeline unbroken**

Run: `npm run tune:dry-run`
Expected: 2-iteration smoke test completes without errors. Even though the heuristic tuner now works against the updated baseline, the dry-run should still execute the proposer and convergence math.

- [ ] **Step 6: Final summary commit (optional — if any fix-ups landed during QA)**

If Steps 1-5 required any code changes, commit them. Otherwise, no commit needed — D1 is complete at the Task 18 commit.

---

## D1 done — acceptance criteria checklist

- [ ] All new + updated tests pass (including 52 dialog-integration assertions)
- [ ] All 275+ pre-existing tests still pass (including `balance-regression` against the new baseline)
- [ ] `content/quotes/*.json` both migrated to object-shape
- [ ] ≥30 of 36 `vs_*` buckets per side populated (from Task 16)
- [ ] Canonical 13 counter-pairing buckets all populated with ≥2 lines (from Tasks 11-12 plus any curated additions)
- [ ] Manual QA confirmed: ⚔️ COUNTER log line fires when expected; quote context is on-topic
- [ ] `balance-baseline.json` regenerated with documented rationale
- [ ] `npm run tune:dry-run` still works
- [ ] `docs/dialog-source-material.md` committed
- [ ] `scripts/dialog-author/*.js` committed and invokable
- [ ] `CLAUDE.md` updated
