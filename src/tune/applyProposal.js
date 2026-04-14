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
