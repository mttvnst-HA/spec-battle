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
