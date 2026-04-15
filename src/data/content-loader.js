import { C, GAME, pick } from "../constants.js";
import { vsKey } from "../game/dialog.js";

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
