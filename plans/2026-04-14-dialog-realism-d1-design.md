# Dialog Realism — Phase D1 Design (Crafted Foundation)

**Created:** 2026-04-14
**Branch:** `dialog-realism`
**Type:** Design spec (brainstorming output). Implementation plan is a separate follow-up doc produced via the superpowers:writing-plans skill.

## 1. Problem

Today, each move in `content/quotes/*.json` has a flat pool of 5-9 quotes. When `resolveMove()` fires, it calls `pick(move.quotes)` — uniform random, no awareness of what the opponent just did. The result: ENGINEER and CONTRACTOR each deliver two independent monologues. There is no dialog in the dialog system.

The user wants interactions that feel realistic: engineer responses should be specific, domain-authentic reactions to the contractor's last move. OR-EQUAL GAMBIT should get slapped with a salient-characteristics line, not a generic rejection. VALUE ENGINEER should be NCR'd on the non-conforming underlying work. Every exchange should land a real NAVFAC gag.

## 2. Scope

This spec covers **Phase D1 only** — the "Crafted Foundation." Phases D2 and D3 become follow-up specs.

**D1 delivers:**
- A context-aware dialog layer. When ENGINEER plays move X after CONTRACTOR played Y, the quote comes from a dedicated `vs_Y` pool on X (and vice versa).
- **Canonical counter pairings** — 13 specific (initiator, counterer) pairs that both:
  - Apply a mechanical damage bonus (×1.3) and a guaranteed status effect kicker when the counter move has one.
  - Pull dialog from the dedicated `vs_*` bucket, reinforcing the "I caught you" narrative moment.
- Fully authored canonical content: every engineer move × every contractor move (36 slots per side, 72 total) gets a dedicated context bucket with 3-5 lines. Plus an `opening` bucket per move (12 total). Rough total: 600-850 lines.
- No runtime LLM. Fully deterministic. Sim-safe.
- `balance-baseline.json` regenerated to account for the counter-mechanic shift.

**D1 defers to later phases:**
- **D2 — Voice & Memory:** state modulation (HP/MP/status/streak coloring the quote pool); catchphrase escalators at dramatic moments; sliding no-repeat window across a match.
- **D3 — Infinite Variety:** runtime LLM hybrid with per-context cache for non-canonical filler slots; sim-bypass to preserve determinism.

**Explicitly NOT in D1:** new moves, new status effects, MP cost changes, UI changes beyond the battle log, autonomous-tuning roadmap entanglement. This is a parallel track to the Phase-2.x tuning work.

## 3. Architecture

### Runtime data flow

Reducer (`PLAYER_MOVE` / `ENEMY_MOVE`) threads the opponent's last move into `resolveMove()`. Two new pure-function modules own the selection and bonus logic:

```
                          ┌─ dialog.js ──┐
resolveMove(state, attacker, move,        │ pickDialog() → quote
  opponentLastMove) ──────┤               └─────────────
                          │                                   ┌─ constants.js ─┐
                          ├─ counters.js ─┐                   │ COUNTER_ROUTING │
                          │ isCounter() ──┤──→ calcDmg  ───→  │ GAME.counter*   │
                          │               └──→ rollStatus     └─────────────────┘
                          │
                          └─ logs / state updates
```

### New state fields

Reducer state gains:
- `engLastMove: string | null` — name of engineer's most recent move; `null` at game start and after `RESET`.
- `conLastMove: string | null` — same for contractor.

Updated at the end of `PLAYER_MOVE` and `ENEMY_MOVE`. **Not** updated on a stunned-skip turn: if you didn't act, you didn't signal anything counter-able. A contractor who gets stunned can't be counter-bonus'd on the turn after their stun recovery turn.

### New modules

- **`src/game/dialog.js`** — `pickDialog({ attackerSide, move, opponentLastMove, isOpening }) → string`. Pure; uses seeded `rng.pick`. Selection order:
  1. If `isOpening` and `move.quotes.opening` populated → pull from that.
  2. Else if `opponentLastMove` and `move.quotes[vsKey(opponentLastMove)]` populated → pull from that.
  3. Else → pull from `move.quotes.default`.

- **`src/game/counters.js`** — exports `COUNTER_ROUTING` table (see §5), `isCounter(attackerSide, moveName, opponentLastMoveName) → bool`, and (for test convenience) `getCounterEntry(...) → object | null`.

### Modified modules

- **`src/game/logic.js`:**
  - `resolveMove()` gains `opponentLastMove` param; threads `isCounter` into damage/status calls; threads `isOpening` (derived from whether the attacker's side has a last move yet) into `pickDialog`.
  - `calculateDamage(move, defenderStatus, isCounter)` — new `isCounter` arg; when true, multiplies by `GAME.counterMultiplier` (default 1.3) **before** crit and defender-status modifiers.
  - `rollStatusEffect(move, isCounter)` — when `isCounter` is true and the move has a stun/slow/weaken effect, skip the random roll and return the status directly. No-op when the move has no status, heal, or defense.
  - Log additions: when `isCounter`, prepend a ⚔️ COUNTER line to the battle log before damage/status lines so the player sees why the hit was bigger.

- **`src/game/reducer.js`:** `PLAYER_MOVE` and `ENEMY_MOVE` pass `opponentLastMove` to `resolveMove`, then write the attacker's move name into `engLastMove` / `conLastMove` on the result state.

- **`src/data/content-loader.js`:** normalizes `content/quotes/*.json` to object-shape on load. Accepts both legacy flat-array (wraps as `{ default: [...] }`) and new object shape. Validates that every `vs_*` key references a real opponent move (underscore-normalized). Fails fast on unknown key.

- **`src/constants.js`:** add `GAME.counterMultiplier = 1.3`, `GAME.aiCounterBias = 0.7`.

### Why this module split

`dialog.js` and `counters.js` each do one thing, stay small, and are fully unit-testable without touching the reducer. Keeps `logic.js` from growing into a grab-bag.

## 4. Content schema

New per-move quote shape (backward compatible — flat-array shape still loads):

```json
"REJECT SUBMITTAL": {
  "default": [
    "Disapproved. See red-lines attached.",
    "Revise and resubmit. Again."
  ],
  "opening": [
    "Let's start with the submittal register. I see gaps."
  ],
  "vs_SUBMIT_RFI": [
    "RFIs don't fix non-conforming submittals. Disapproved.",
    "Your 'clarification' is really a pre-approval attempt. Denied."
  ],
  "vs_CLAIM_DSC":      [ "..." ],
  "vs_VALUE_ENGINEER": [ "..." ],
  "vs_SCHEDULE_DELAY": [ "..." ],
  "vs_OR_EQUAL_GAMBIT": [ "..." ],
  "vs_RESERVE_RIGHTS": [ "..." ]
}
```

### Conventions

- `default` — required; fallback when no context bucket matches.
- `opening` — optional; used on the attacker's first move of the game (no opponent last move yet).
- `vs_<MOVE_NAME>` — optional; keys normalize both spaces and hyphens to underscores, preserving case (so `OR-EQUAL GAMBIT` → `vs_OR_EQUAL_GAMBIT`, `RED-LINE SPEC` → `vs_RED_LINE_SPEC`). Unknown keys fail content-integrity validation.
- Minimum 2 lines per populated bucket.
- No duplicate lines across buckets within a single move.

### Coverage target for D1

- 36 `vs_*` buckets populated per side (all 6×6 combinations).
- `default` bucket populated for all 12 moves.
- `opening` bucket populated for all 12 moves.
- **Minimum gate:** ≥30 of 36 `vs_*` buckets per side populated before D1 is shippable (allows some gaps while keeping density high).

## 5. Counter pairings

Counters are data, not hardcoded logic:

```js
// src/game/counters.js
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
```

13 entries. INVOKE SHALL and OR-EQUAL GAMBIT each appear twice as counter moves — deliberate, to reinforce their identity as universal "contract language rules" and "approved-equal loophole" slams respectively.

### Narrative hooks (for authoring reference)

| Initiator | Counterer side | Counter move | Why it lands |
|---|---|---|---|
| OR-EQUAL GAMBIT | Engineer | INVOKE SHALL | SHALL beats substitution — mandatory language defeats or-equal creep |
| CLAIM DSC | Engineer | INVOKE SHALL | Contract SHALL-language defined what was foreseeable — no Type I DSC |
| VALUE ENGINEER | Engineer | ISSUE NCR | VECP invalid when underlying work is non-conforming |
| SCHEDULE DELAY | Engineer | CURE NOTICE | Contractor-caused delays → default-termination territory |
| SUBMIT RFI | Engineer | CITE UFC | RFI answered by citing mandatory criteria |
| OR-EQUAL GAMBIT | Engineer | RED-LINE SPEC | Alternate counter — red-line the substitution documents |
| SUBMIT RFI | Engineer | REJECT SUBMITTAL | "Clarification RFI" is a pre-approval attempt for non-conforming work |
| CITE UFC | Contractor | CLAIM DSC | UFC doesn't cover subsurface — that's DSC territory |
| CURE NOTICE | Contractor | RESERVE RIGHTS | Protest the cure notice; preserve claims |
| ISSUE NCR | Contractor | SCHEDULE DELAY | "Your NCR drove us off critical path" |
| INVOKE SHALL | Contractor | SUBMIT RFI | "SHALL what, exactly? Please clarify — this is an RFI" |
| REJECT SUBMITTAL | Contractor | VALUE ENGINEER | "Here's a VECP for the rejected item, cheaper" |
| RED-LINE SPEC | Contractor | OR-EQUAL GAMBIT | "Red-lines don't preclude an approved equal under 01 60 00" |

## 6. Counter mechanics

### Damage bonus

When a counter is detected in `resolveMove`, `calculateDamage` applies the multiplier in this order:

```
damage = baseRoll
       × GAME.counterMultiplier (1.3, if counter)
       × GAME.critMultiplier (1.6, if crit)
       × defenderStatusMultiplier (0.5 DEF+ | 1.3 WEAKENED | 1.0 otherwise)
```

A counter-crit on a weakened defender lands at `baseRoll × 1.3 × 1.6 × 1.3 = 2.70x`. Target dies a lot. Acceptable — these are rare, earned moments.

### Guaranteed status kicker

When `isCounter` is true and the counter move has a stun/slow/weaken effect, the random roll is bypassed. Concrete impact:

| Counter move | Normal status chance | On counter |
|---|---|---|
| INVOKE SHALL (stun, ~55%) | 55% → **100%** |
| CURE NOTICE (stun, ~55%) | 55% → **100%** |
| ISSUE NCR (weaken, always) | 100% → unchanged |
| SCHEDULE DELAY (slow, ~40%) | 40% → **100%** |
| Other counter moves | no kicker (move has no roll-based status) |

### Log feedback

When a counter fires, prepend a visible log line so the player knows why the hit was bigger:

```
⚔️ COUNTER! INVOKE SHALL vs OR-EQUAL GAMBIT
  +30% damage — SHALL is mandatory, substitutions need salient-characteristics proof
```

Counter-bonus is an invisible-mechanic candidate. The log line exists to make it legible.

### AI policy update

`pickAIMove` gets a new top-priority rule, inserted above existing heal/weakened/big-attack tiers:

> If `engLastMove` matches a canonical-counter initiator for the contractor side AND contractor can afford the counter move's MP → play it with probability `GAME.aiCounterBias` (default 0.7). Otherwise fall through to existing tiers.

The 0.7 probability (not 1.0) keeps the AI from being perfectly predictable. Lives as a tunable so the tuning loop can adjust it later.

### Balance impact

`balance-baseline.json` regenerates as part of D1. Expected shift direction: engineer win rate up a few pp (player benefits from visible counter opportunities more than the AI does even with the bias rule); per-move frequencies shift toward counter moves. Treated as a deliberate deliverable, not a regression.

## 7. Authoring pipeline

All four stages live under `scripts/dialog-author/`. Pipeline is dev-time only — runtime in D1 does not invoke Claude.

### Stage 1 — Research gather

`scripts/dialog-author/research.js` — invokes Claude CLI (reusing the `src/tune/claudeTransport.js` pattern) with prompts targeting NAVFAC/FAR/UFGS canonical exchanges. Outputs `docs/dialog-source-material.md` (committed). Humans read and edit it — the curated document becomes the context base for later role-play sessions. This lets subsequent stages work from grounded source material rather than hallucinating afresh.

### Stage 2 — Role-play sessions

`scripts/dialog-author/roleplay.js` — runs one scripted battle scenario through a multi-turn Claude CLI invocation with two in-character system-prompt personas (grizzled engineer, slick contractor PM) and `docs/dialog-source-material.md` as context. Parameters: initial state, starting side, turn count. Output: transcript JSON to `scratch/dialog-transcripts/session-<timestamp>.json` (gitignored). Non-deterministic by design — variation across sessions is the point.

### Stage 3 — Mining

`scripts/dialog-author/mine.js` — ingests all transcripts under `scratch/dialog-transcripts/`, extracts lines, buckets them by `(speaker_move, listener_prior_move)`. Mining is Claude-assisted: prompts the CLI with each transcript and asks it to extract the 5-10 best lines per observed context pair, preserving voice. Dedup trims near-duplicates. Output: `scratch/dialog-candidates.json` (gitignored).

### Stage 4 — Human curation

**Manual.** User (or Claude acting as editor, under explicit user direction) opens `scratch/dialog-candidates.json`, cuts weak lines, fixes factual errors (wrong FAR clause numbers, misremembered UFC sections), tightens voice consistency, and moves curated content into `content/quotes/*.json` using the new object schema. This is the only stage that writes to committed content.

### Coverage dashboard

A small one-off script (`scripts/dialog-author/coverage.js`) reports which `vs_*` buckets have fewer than the minimum-line-count threshold, so subsequent role-play sessions can target thin coverage areas rather than re-hitting already-dense ones.

### Scope acknowledgment

Rough math: ~30-50 role-play sessions to reach density target (3-5 lines × 72 context buckets, after curation cuts). This is sustained authoring across many CLI invocations, not a one-shot. The pipeline makes it tractable and structured; it does not make it instant.

### Curation is NOT automated

Every line shipped to `content/quotes/*.json` passes through human judgment. The pipeline accelerates authoring; it does not replace authorship.

## 8. Testing

### New test files

| File | Covers |
|---|---|
| `src/__tests__/dialog.test.js` | `pickDialog()` selection: opening > vs_X > default fallback chain; underscore normalization; RNG determinism; graceful handling of missing buckets |
| `src/__tests__/counters.test.js` | `isCounter()` matching; lookup by side + move name + opponent last move; unknown names return false; AI counter bias obeys seeded RNG |
| `src/__tests__/dialog-integration.test.js` | End-to-end per canonical counter (13 tests): seed RNG, drive reducer through initiator then counter, assert (a) damage ≈ baseline × 1.3, (b) guaranteed status if applicable, (c) ⚔️ COUNTER log line, (d) quote sourced from the `vs_*` bucket |

### Updated test files

| File | Change |
|---|---|
| `content-integrity.test.js` | Validate new object schema: `default` required; `opening` optional; `vs_*` keys resolve to real opponent move names after normalization; min 2 lines per populated bucket; no duplicates within a bucket; coverage gate (≥30 of 36 `vs_*` buckets per side) |
| `content-loader.test.js` | Cover both legacy flat-array and new object-shape normalization paths; verify all 48 contexts per side load and resolve cleanly |
| `logic.test.js` | `calculateDamage` with `isCounter: true` multiplier order; `rollStatusEffect` with `isCounter: true` guarantees status when applicable, no-ops otherwise; ⚔️ COUNTER log line assertion |
| `reducer.test.js` | `engLastMove` / `conLastMove` update on move actions; start `null`; cleared by `RESET`; stunned-skip turn does NOT update (intentional) |
| `sim-policies.test.js` | AI policy prefers canonical counter when condition met; obeys `GAME.aiCounterBias` threshold |
| `constants.test.js` | Add structural assertion: `GAME.counterMultiplier` in `[1.0, 2.0]`, `GAME.aiCounterBias` in `[0, 1]` |
| `balance-regression.test.js` | **No code change.** Expected to fail on current baseline until baseline is regenerated as a D1 deliverable. |

### No tests for authoring scripts

`scripts/dialog-author/*.js` are one-shot dev tools. They're evaluated by reading their outputs during curation, not by unit tests. Same stance as `scripts/simulate.js`.

### Sim-harness compatibility

Sim runs do not exercise dialog text — confirmed by grepping `src/sim/`. Counter mechanics DO affect sim (damage/status math changes), which is the source of the baseline shift.

### Balance baseline regeneration — explicit D1 deliverable

1. All other D1 tests pass.
2. Run `npm run sim:update-baseline`.
3. Manual review of the diff.
4. Commit new baseline in a dedicated commit with a message documenting the expected shift direction (engineer win-rate up, counter moves more frequent).

## 9. File inventory

### New files

- `src/game/dialog.js`
- `src/game/counters.js`
- `src/__tests__/dialog.test.js`
- `src/__tests__/counters.test.js`
- `src/__tests__/dialog-integration.test.js`
- `scripts/dialog-author/research.js`
- `scripts/dialog-author/roleplay.js`
- `scripts/dialog-author/mine.js`
- `scripts/dialog-author/coverage.js`
- `docs/dialog-source-material.md` (produced by Stage 1, committed)

### Modified files

- `src/game/logic.js`
- `src/game/reducer.js`
- `src/data/content-loader.js`
- `src/constants.js`
- `content/quotes/engineer.json` (schema migration + authored content)
- `content/quotes/contractor.json` (schema migration + authored content)
- `balance-baseline.json` (regenerated)
- `src/__tests__/content-integrity.test.js`
- `src/__tests__/content-loader.test.js`
- `src/__tests__/logic.test.js`
- `src/__tests__/reducer.test.js`
- `src/__tests__/sim-policies.test.js`
- `src/__tests__/constants.test.js`
- `CLAUDE.md` (new section documenting the dialog system + authoring pipeline)

### New gitignored paths

- `scratch/dialog-transcripts/`
- `scratch/dialog-candidates.json`

## 10. Acceptance criteria (D1 "done")

1. All new + updated tests pass.
2. All existing tests pass (including `balance-regression` after baseline regen).
3. `content/quotes/*.json` migrated to object-shape for both characters; ≥2 lines per populated bucket; ≥30 of 36 `vs_*` buckets populated per side.
4. Manual QA: play 5 games end-to-end via `npm run dev`; ⚔️ COUNTER log line appears when expected; quotes in canonical counter exchanges read as on-topic.
5. `balance-baseline.json` regenerated and committed in a dedicated commit with rationale.
6. `npm run tune:dry-run` still works (autonomous-tuning pipeline unbroken by D1 changes).
7. `docs/dialog-source-material.md` committed.
8. `scripts/dialog-author/*.js` committed and invokable.

## 11. Open questions flagged for review

- **Stun-and-last-move interaction:** spec picks "stunned side does NOT update `*LastMove` on a skipped turn." This gives the stunned side a slight tempo advantage on recovery (no counter-bonus window against them). Alternative (preserve pre-stun last-move) makes counter-windows more persistent. Call: keep current choice unless playtesting shows it feels wrong.
- **Is 1.3× the right counter multiplier?** Design picks 1.3. Higher (1.4-1.5) makes counters more dominant; lower (1.2) risks making them feel invisible. 1.3 + guaranteed status kicker should land. Tuning loop can adjust post-D1 if desired.
- **Coverage gate (30 of 36):** is this strict enough, or should D1 require full 36? Picking 30 to allow some "I couldn't find a good line for REJECT SUBMITTAL vs SUBMIT RFI after curation" cases; easy to tighten later.

## 12. Out of scope for D1 (explicit)

- Runtime LLM dialog (D3)
- State modulation of voice (D2)
- Catchphrase escalators (D2)
- No-repeat sliding window (D2)
- New moves / status effects / UI changes
- Integration with the Phase-2.x autonomous-tuning roadmap
