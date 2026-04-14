import { C, GAME, pick } from "../constants.js";

// Import JSON content
import engineerMoves from "../../content/moves/engineer.json" with { type: "json" };
import contractorMoves from "../../content/moves/contractor.json" with { type: "json" };
import engineerQuotes from "../../content/quotes/engineer.json" with { type: "json" };
import contractorQuotes from "../../content/quotes/contractor.json" with { type: "json" };
import introsData from "../../content/intros.json" with { type: "json" };
import gameOverData from "../../content/game-over.json" with { type: "json" };

// Map color name strings from JSON to C palette values
const COLOR_MAP = {
  yellow: C.yellow,
  white: C.white,
  orange: C.orange,
  red: C.red,
  cyan: C.cyan,
  bright: C.bright,
  muted: C.muted,
  hpGreen: C.hpGreen,
};

function resolveColor(name) {
  return COLOR_MAP[name] || C.white;
}

// Merge moves with their quotes
function buildMoves(moveDefs, quotes) {
  return moveDefs.map(move => ({
    ...move,
    quotes: quotes[move.name] || [],
  }));
}

// Build character objects
export const ENGINEER = {
  name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: GAME.mpRegen,
  moves: buildMoves(engineerMoves, engineerQuotes),
};

export const CONTRACTOR = {
  name: "CONTRACTOR", maxHp: 150, maxMp: 60, mpRegen: GAME.mpRegen,
  moves: buildMoves(contractorMoves, contractorQuotes),
};

// Build intro sequences with resolved colors
const INTRO_SEQUENCES = introsData.map(intro =>
  intro.steps.map(step => ({
    entry: { text: step.text, color: resolveColor(step.color) },
    delay: step.delay,
  }))
);

export const pickIntroSequence = () => pick(INTRO_SEQUENCES);

// Game over text
export const GAME_OVER_TEXT = gameOverData;
