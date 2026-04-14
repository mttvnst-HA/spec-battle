# SPEC BATTLE RPG

A turn-based RPG where a federal construction ENGINEER battles a CONTRACTOR using specification language, contract clauses, and bureaucratic warfare.

## Tech Stack

- **Framework:** React 18 + Vite
- **Styling:** All inline styles (no CSS framework)
- **Font:** Press Start 2P (pixel font, loaded via Google Fonts in index.html)
- **State:** useReducer for game state (pure reducer, no stale closures)
- **Sprites:** SVG pixel art rendered from character arrays

## Architecture

Single-file game component at `src/App.jsx`. Key sections:

- **Pixel sprite data** - character appearance defined as string arrays mapped to color palettes
- **Move definitions** - each move has name, emoji, description, damage range, MP cost, effect type, and context-sensitive quote arrays
- **Reducer** - pure function handling PLAYER_MOVE, ENEMY_MOVE, RESET actions
- **resolveMove()** - calculates damage, crits, status effects, selects quotes
- **pickAIMove()** - contractor AI with situational logic (heals when low, finishes when enemy low, uses defense when weakened)
- **Screen components** - TitleScreen, BattleScreen, GameOver

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
