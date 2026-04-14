# SPEC BATTLE RPG

A turn-based RPG where a federal construction ENGINEER battles a CONTRACTOR using specification language, contract clauses, and bureaucratic warfare.

## Tech Stack

- **Framework:** React 18 + Vite
- **Runtime:** Node ≥22. Plain-node JSON imports require `with { type: "json" }` attributes (Vite/Vitest handle invisibly).
- **Styling:** All inline styles (no CSS framework)
- **Font:** Press Start 2P (pixel font, loaded via Google Fonts in index.html)
- **State:** useReducer for game state (pure reducer, no stale closures)
- **Sprites:** SVG pixel art rendered from character arrays

## Architecture

Modular file structure:

```
ROADMAP.md               -- Autonomous development roadmap (Phase 1 foundation + stubs)
plans/                   -- Implementation plans, one per roadmap phase
scripts/
  simulate.js            -- CLI: runs N sim games, writes balance-report.json or balance-baseline.json
balance-baseline.json    -- Committed baseline; regression test diffs against this
content/                 -- Game content as editable JSON (see content/README.md)
  quotes/engineer.json   -- Engineer move quotes, keyed by move name
  quotes/contractor.json -- Contractor move quotes
  moves/engineer.json    -- Engineer move definitions (stats, effects)
  moves/contractor.json  -- Contractor move definitions
  intros.json            -- Randomized intro sequences
  game-over.json         -- Victory/defeat text pools
src/
  App.jsx              -- Root component (screen state machine, global CSS keyframes)
  constants.js         -- Colors (C), font (PIXEL_FONT), timing/game config, STATUS enum, utils
  data/
    content-loader.js  -- Imports JSON content, resolves colors, merges quotes into moves
    characters.js      -- Re-exports ENGINEER & CONTRACTOR from content loader
    sprites.js         -- Pixel sprite arrays + color map
  game/
    logic.js           -- calculateDamage(), rollStatusEffect(), resolveMove(), pickAIMove()
    reducer.js         -- Game reducer (PLAYER_MOVE, PLAYER_STUNNED, ENEMY_MOVE, RESET)
    rng.js             -- Seedable xorshift32; delegates to Math.random() when unseeded
  sim/
    policies.js        -- randomPolicy + aiPolicy (wraps pickAIMove) for simulated play
    runGame.js         -- Drives one game via reducer with two policies + seed
    runBatch.js        -- Aggregates N games into a BalanceReport
  components/
    PixelSprite.jsx    -- SVG sprite renderer with shake/flash animations
    StatBox.jsx        -- HP/MP bars + character stat display
    LogBox.jsx         -- Scrollable battle log
    BattleScreen.jsx   -- Main battle UI + turn management effects
    TitleScreen.jsx    -- Title screen with blinking prompt
    GameOver.jsx       -- Victory/defeat screen
```

Key design decisions:
- Game balance constants centralized in `constants.js` (GAME object)
- Status effects use `STATUS` enum instead of string literals
- `resolveMove()` delegates to `calculateDamage()` and `rollStatusEffect()` for testability
- Characters own their `mpRegen` rate instead of hardcoding

## Game Mechanics

- Engineer has 140 HP / 70 MP. Contractor has 150 HP / 60 MP.
- 6 moves per character, 3x2 button grid
- Status effects: STUNNED (skip turn), SLOWED (visual only currently), WEAKENED (take 30% more damage), DEF+ (take 50% less damage)
- MP regens +4 per turn passively
- 12% crit rate, 1.6x crit multiplier
- Context-sensitive quotes: each move has its own quote pool (5-6 lines)

## Domain Context

This game is set in the world of NAVFAC (Naval Facilities Engineering Systems Command) federal construction. The humor comes from real adversarial dynamics:

- **Engineers** review submittals, reject non-conforming work, cite UFC (Unified Facilities Criteria) and UFGS (Unified Facilities Guide Specifications), issue NCRs (Non-Conformance Reports), and escalate via Cure Notices
- **Contractors** submit RFIs (Requests for Information) strategically, claim Differing Site Conditions under FAR 52.236-2, propose Value Engineering to pocket savings splits, manipulate CPM schedules, and submit "or equal" substitutions
- Engineers do NOT submit RFIs. RFIs are a contractor weapon.
- The word "SHALL" in federal specs is a mandatory obligation, not a suggestion

## Content Pipeline

All game content (quotes, moves, intros, game over text) lives in `content/` as editable JSON. See `content/README.md` for schemas and contribution guide.

- **Add a quote:** edit `content/quotes/engineer.json` or `contractor.json`
- **Add an intro:** add an object to `content/intros.json`
- **Add game over text:** add a string to `content/game-over.json`
- **Add a move:** add to `content/moves/*.json` + matching quotes

`src/data/content-loader.js` imports all JSON, resolves color names to hex, and merges quotes into move definitions. `characters.js` re-exports from the content loader.

## Reference Document

The game bible lives at `reference/ktr-vs-engineer-bible.md`. Sources include CMAA RFI impact studies, FAR clause references, USACE three-phase inspection systems, and real construction industry humor.

## Development Commands

```bash
npm install
npm run dev           # Dev server at localhost:5173
npm run build         # Production build to dist/
npm test              # Run all 236 tests (vitest)
npm run sim              # Run 200 games per matchup, write balance-report.json
npm run sim:update-baseline  # Run same, write balance-baseline.json (commit it!)
npx vitest run src/__tests__/content-integrity.test.js  # Run one test file
```

### Test Structure

| File | Purpose |
|------|---------|
| `content-integrity` | Validates JSON schemas, required fields, no duplicate quotes |
| `content-loader` | Verifies character stats, quote merging, color resolution |
| `logic` | Damage calc, status effects, crits, AI decisions |
| `reducer` | All action types, turn flow, win detection, MP regen |
| `constants` | Game balance snapshots, utility functions |
| `rng` | Seedable xorshift32 determinism + Math.random fallback |
| `sim-policies` | Random + AI policies: affordability, side-correctness, determinism |
| `sim-runGame` | One-game driver: determinism, termination, move-count tracking |
| `sim-runBatch` | N-game aggregation: BalanceReport shape, win-rate sums, determinism |
| `balance-regression` | Diffs a fresh run against `balance-baseline.json` per matchup |

## Simulation harness

Headless, seeded simulation of spec-battle. Lives under `src/sim/` and `scripts/`.

- `npm run sim` runs 200 games per matchup at seed=1 and writes `balance-report.json` (gitignored).
- `npm run sim:update-baseline` writes to `balance-baseline.json` (committed — it's the regression contract).
- Matchups: Random-vs-Random (pure rule balance) and Random-vs-`pickAIMove` (shipping AI).
- Determinism comes from `src/game/rng.js` (xorshift32). When unseeded, it delegates to `Math.random()` so existing `vi.spyOn(Math, "random")` tests keep working.
- `aiPolicy` only supports the contractor side (wraps `pickAIMove`); calling it with `"engineer"` throws. Engineer has no shipping AI — use `randomPolicy` or a custom one.
- Any intentional balance change requires regenerating and committing a new baseline.
