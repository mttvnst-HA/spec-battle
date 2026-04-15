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
ROADMAP.md               -- Autonomous development roadmap (Phase 1 foundation + 2.1 heuristic tuning + 2.2 LLM proposer design; see file for current state)
plans/                   -- Implementation plans, one per roadmap phase
scripts/
  simulate.js            -- CLI: runs N sim games, writes balance-report.json or balance-baseline.json
  tune.js                -- CLI: heuristic or LLM tuning loop (see Tuning harness section)
  tune-sim.js            -- Fresh-process sim driver spawned by tune.js (Phase 2.2e; see CLAUDE.md)
  dialog-author/         -- Dev-time dialog authoring scripts (research, roleplay, mine, fill-silly, coverage)
docs/
  dialog-source-material.md  -- Distilled NAVFAC/FAR corpus seeding dialog-author prompts
balance-baseline.json    -- Committed baseline; regression test diffs against this
content/                 -- Game content as editable JSON (see content/README.md)
  quotes/engineer.json   -- Engineer move quotes, keyed by move name
  quotes/contractor.json -- Contractor move quotes
  moves/engineer.json    -- Engineer move definitions (stats, effects)
  moves/contractor.json  -- Contractor move definitions
  game.json              -- GAME balance constants (critRate, mpRegen, counterMultiplier, etc.)
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
    dialog.js          -- pickDialog() — opening > vs_<opponent> > default bucket resolution
    counters.js        -- COUNTER_ROUTING triples + isCounter() helper
  sim/
    policies.js        -- randomPolicy + aiPolicy (wraps pickAIMove) for simulated play
    runGame.js         -- Drives one game via reducer with two policies + seed
    runBatch.js        -- Aggregates N games into a BalanceReport
    runAveragedBatch.js -- Multi-seed averaged BalanceReport (tune-only, K=3 chunks)
  tune/
    loop.js            -- Orchestrator: propose → test → sim → accept/revert; convergence + budget + kill-switch
    proposer.js        -- Heuristic 6-rule round-robin library (default proposer)
    llmProposer.js     -- Claude Code CLI proposer; buildPrompt + parseBundle
    claudeTransport.js -- execFileSync wrapper around `claude -p`; timeout + error surfacing
    applyProposal.js   -- writeBundle / revertBundle against content/*.json; transactional
    convergence.js     -- isConverged (band check), isImprovement (strict-< worst-distance gate)
    gitOps.js          -- git add + git commit wrappers for accepted bundles
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
- `research.js` → produces `docs/dialog-source-material.md` (committed — the distilled NAVFAC/FAR corpus that seeds every downstream prompt).
- `roleplay.js` → one multi-turn in-character session → `scratch/dialog-transcripts/session-<ts>.json` (gitignored).
- `mine.js` → aggregates transcripts → `scratch/dialog-candidates.json` (gitignored).
- `fill-silly.js` → bucket-targeted authoring (enumerates `(attacker-move, prior-move)` counter pairings and batches them into focused Opus calls with a rigid tone spec). Writes to `scratch/dialog-candidates.json`. This is the primary authoring tool post-PR #8 — `roleplay.js` and `mine.js` remain for free-form corpus generation when a broader tone exploration is wanted.
- `coverage.js` → reports `vs_*` bucket populate state. Use to target thin areas in subsequent `fill-silly.js` runs.
- Human curation → curated lines moved into `content/quotes/*.json`.

All five scripts use `src/tune/claudeTransport.js` for Claude CLI calls. `TUNE_CLAUDE_BIN` / `TUNE_MODEL` / `TUNE_TIMEOUT_MS` env vars apply the same way as for the tuning harness. No runtime LLM — the curated static JSON is the shipping artifact.

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
npm test              # Run all tests (vitest)
npm run sim              # Run 1000 games per matchup, write balance-report.json
npm run sim:update-baseline  # Run same, write balance-baseline.json (commit it!)
npm run tune             # Heuristic tuning loop (up to 30 iters / 45 min)
npm run tune:llm         # LLM-driven tuning loop (same budget; see Tuning harness > LLM proposer)
npm run tune:dry-run     # 2-iteration smoke test — no file writes, no git ops
npx vitest run src/__tests__/content-integrity.test.js  # Run one test file
```

**Commit style:** conventional-commits prefixes (`refactor(content):`, `test(constants):`, `docs(roadmap):`, `fix(test):`, `feat(tune):`) plus a `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` trailer on AI-assisted commits. Keep subjects under ~70 chars; put rationale in the body.

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
| `tune-convergence` | Pure convergence math: band check, improvement gate, 2pp guard |
| `tune-applyProposal` | Bundle write/revert against `content/game.json` + moves files; transactional mid-write rollback |
| `tune-proposer` | 6-rule round-robin heuristic library; shape + step-size invariants (relaxed in Phase 2.2a) |
| `tune-gitOps` | Commit-wrapper escaping (shell metacharacters); injectable exec |
| `tune-loop` | Orchestrator: convergence, budget, kill-switch, improvement gating, bounded retry, write-failed/invalid-output outcomes, worstDistanceCandidate capture, transport-error surfacing |
| `tune-claudeTransport` | createCliTransport fake-exec: success, nonzero exit, timeout, input validation |
| `tune-llmProposer-prompt` | buildPrompt shape: static prefix, content embedding, history with deltas, retry context, candidate-distance in history |
| `tune-llmProposer-parse` | parseBundle ladder (envelope/fences/brace-extract) + schema + step-size violations |
| `tune-llmProposer-propose` | createLlmProposer glue with fake transport: happy path, parse passthrough, null on transport throw, lastError getter behavior |

## Simulation harness

Headless, seeded simulation of spec-battle. Lives under `src/sim/` and `scripts/`.

- `npm run sim` runs 1000 games per matchup at seed=1 and writes `balance-report.json` (gitignored). (Phase 2.2c: increased from 200 for better noise floor regression coverage.)
- `npm run sim:update-baseline` writes to `balance-baseline.json` (committed — it's the regression contract).
- Matchups: Random-vs-Random (pure rule balance) and Random-vs-`pickAIMove` (shipping AI).
- Determinism comes from `src/game/rng.js` (xorshift32). When unseeded, it delegates to `Math.random()` so existing `vi.spyOn(Math, "random")` tests keep working.
- `aiPolicy` only supports the contractor side (wraps `pickAIMove`); calling it with `"engineer"` throws. Engineer has no shipping AI — use `randomPolicy` or a custom one.
- Any intentional balance change requires regenerating and committing a new baseline.

## Tuning harness

Heuristic balance tuner. Lives under `src/tune/` and `scripts/tune.js`.

- `npm run tune` runs the loop; `npm run tune:dry-run` is the 2-iter smoke test (no writes/commits).
- Loop NEVER writes `balance-baseline.json`. On exit it writes `balance-baseline.next.json` (gitignored); human accepts via `npm run sim:update-baseline`.
- Kill switch: `.tuning-abort` file (gitignored) primary, SIGINT/SIGTERM, budget caps. Takes priority over budget exhaustion.
- `vitest.config.js` has `fileParallelism: false` — required because `tune-applyProposal` and `tune-proposer` tests mutate real `content/*.json`. Do NOT remove it; parallel workers interleave writes and produce truncated-JSON errors.
- `writeProposal` uses `JSON.stringify(obj, null, 2)`. After the Phase 2.2a normalization pass (commit `23e22d1`), all `content/*.json` files are stored in that exact format, so write-then-revert produces byte-identical output — no cosmetic diff. If you hand-edit a content JSON file with a different formatter, re-run the Task 1 normalization before committing.
- Phase 2.2a (commits `fee149c` + `7fd24ed`) relaxed value-hardcoded assertions in `constants.test.js` (Game Balance Constants block, structural/range checks) and `tune-proposer.test.js` (propose round-robin block, shape + step-size invariants). `content-loader.test.js` was already structural. Drift regression coverage lives in `balance-regression.test.js` against `balance-baseline.json`.
- Proposer's `propose(report, iteration, cfg = readConfig())` accepts an injected config for fully in-memory tests.
- Phase 2.2d: the tune path runs sim averaged across K=3 disjoint seed chunks (3000 games per matchup per iteration) via `src/sim/runAveragedBatch.js`. Standard error on per-matchup winrate drops from ~1.58pp (n=1000) to ~0.91pp — tight enough that a correctly-directed ±1 step is statistically detectable inside `isImprovement`'s strict-inequality gate. Chunks use disjoint seed ranges (`startSeed + k*count`), so averaging is deterministic. `balance-baseline.json` and `npm run sim` remain single-seed — averaging is tune-only, the baseline contract stays unaveraged.
- Phase 2.2e: `scripts/tune.js` `runSim()` spawns a **fresh Node process per iteration** via `execFileSync("node", ["scripts/tune-sim.js", cfg])`. This is load-bearing, not scaffolding. Rationale: `src/data/content-loader.js` and `src/constants.js` use static `import ... with { type: "json" }` for `content/*.json`. ESM binds those imports once at module-init and never re-reads from disk, so an in-process `runSim()` called after `writeBundle` sees stale content and reports the pre-mutation winrate. Symptoms through Phase 2.2d: all LLM bundles marked `not-improvement` with a flat `worstDistanceCandidate`, because the sim was measuring the unchanged baseline regardless of what the proposer wrote. The subprocess boundary fixes this by construction — every `runSim` is a clean module-init — and also gives crash isolation and a natural seam for a future remote sim worker. `scripts/tune-sim.js` is the tiny wrapper; `src/__tests__/tune-sim-driver.test.js` covers the CLI contract and contains a regression canary that mutates `content/moves/engineer.json` mid-test and asserts the sim output shifts. Do not reintroduce in-process `runSim` unless `ENGINEER`/`CONTRACTOR`/`GAME` stop being module-init consts.

### LLM proposer (Phase 2.2b)

- `TUNE_PROPOSER=llm npm run tune` (or `npm run tune:llm`) selects the Claude Code CLI subprocess proposer. Default path (no env var) uses the Phase 2.1 heuristic proposer unchanged.
- Transport: `src/tune/claudeTransport.js` spawns `claude -p '<prompt>' --output-format json --model <model>` via `child_process.execFileSync` (no shell, arg-array form). Uses your existing `claude` CLI auth.
- Default model `claude-sonnet-4-6`; override with `TUNE_MODEL=claude-opus-4-6`. Default timeout 120s per call; override with `TUNE_TIMEOUT_MS=180000`.
- `claude` binary resolved via PATH by default; override with `TUNE_CLAUDE_BIN=/absolute/path/to/claude`. Needed when Claude Code is bundled with the desktop app but not on PATH — on Windows the binary lives at `%APPDATA%\Claude\claude-code\<version>\claude.exe`, which is not a PATH entry by default. Set this env var to that absolute path to point the tuning harness at it.
- Windows-only: Claude Code 2.1.x shells out to git-bash for some tooling and errors out with `Claude Code on Windows requires git-bash ...` unless `CLAUDE_CODE_GIT_BASH_PATH` points at `bash.exe` (typically `C:\Users\<you>\AppData\Local\Programs\Git\usr\bin\bash.exe` or `C:\Program Files\Git\bin\bash.exe`). The transport sees the non-zero exit and returns `null` → loop exits `"exhausted"`. Set this env var when invoking the LLM tuning path on Windows.
- Proposer emits `ProposalBundle = { rule, summary, targets: [{target, before, after}, ...] }`. One iteration can move multiple levers coherently.
- Invalid LLM output triggers one bounded retry with the parse/validation error as context. If the retry also fails, the iteration is skipped (outcome: `"invalid-output"`).
- On `exhausted` exit, the loop writes a `## Last transport error` section at the end of `tuning-summary.md` carrying the CLI's error message (timeout, nonzero exit, or ENOENT). Distinguishes rate-limit / quota / CLI-missing cases after the fact (Phase 2.2c).
- Budget defaults for the LLM path: 30 iterations / 45 minutes wall-clock. Override with `--max-iters=N --max-wall-ms=N` as usual.
- `tune:llm` script is portable — passes `--llm` to `scripts/tune.js`, which is equivalent to setting `TUNE_PROPOSER=llm`. Works under cmd.exe, PowerShell, and Git Bash. Prefer `npm run tune:llm` over `TUNE_PROPOSER=llm npm run tune` for consistency across shells.
- No real CLI call is made from any unit test — `llmProposer.js` and `claudeTransport.js` are fixture- and fake-exec-tested. Verify wiring with `TUNE_PROPOSER=llm npm run tune:dry-run` (2 iterations, real CLI, no writes).
