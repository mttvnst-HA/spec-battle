# SPEC BATTLE RPG

A turn-based RPG where a federal construction ENGINEER battles a CONTRACTOR using specification language, contract clauses, and bureaucratic warfare.

## Tech Stack

- **Framework:** React 18 + Vite
- **Styling:** All inline styles (no CSS framework)
- **Font:** Press Start 2P (pixel font, loaded via Google Fonts in index.html)
- **State:** useReducer for game state (pure reducer, no stale closures)
- **Sprites:** SVG pixel art rendered from character arrays

## Architecture

Modular file structure:

```
src/
  App.jsx              -- Root component (screen state machine, global CSS keyframes)
  constants.js         -- Colors (C), font (PIXEL_FONT), timing/game config, STATUS enum, utils
  data/
    characters.js      -- ENGINEER & CONTRACTOR (stats, moves, quotes, mpRegen)
    sprites.js         -- Pixel sprite arrays + color map
  game/
    logic.js           -- calculateDamage(), rollStatusEffect(), resolveMove(), pickAIMove()
    reducer.js         -- Game reducer (PLAYER_MOVE, PLAYER_STUNNED, ENEMY_MOVE, RESET)
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

## Reference Document

The game bible (research on authentic dialogue, tactics, and scenarios) was developed in the originating Claude.ai conversation. Key sources include CMAA RFI impact studies, FAR clause references, USACE three-phase inspection systems, and real construction industry humor.

## Development Commands

```bash
npm install
npm run dev     # Dev server at localhost:5173
npm run build   # Production build to dist/
```
