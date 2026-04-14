import { reducer, initState } from "../game/reducer.js";
import { seed } from "../game/rng.js";
import { STATUS } from "../constants.js";

const DEFAULT_MAX_TURNS = 500;

/**
 * Run one game to completion with the given seed and policies.
 *
 * @param {object} opts
 * @param {number} opts.seed - RNG seed. Same seed + same policies = same game.
 * @param {(state, side) => move} opts.engPolicy - Engineer move selector.
 * @param {(state, side) => move} opts.conPolicy - Contractor move selector.
 *   Both policies MUST return a legal (affordable) move; the sim does not validate.
 * @param {number} [opts.maxTurns=500] - Hard cap on reducer dispatches. Reaching
 *   the cap returns winner='draw'.
 * @returns {{ winner: "engineer" | "contractor" | "draw", turns: number, moveCount: object }}
 *   `turns` counts reducer dispatches — each is one reducer transition, including
 *   stun-skip dispatches. A full player+enemy round is typically 2 turns.
 */
export function runGame({ seed: seedValue, engPolicy, conPolicy, maxTurns = DEFAULT_MAX_TURNS }) {
  seed(seedValue);
  // Skip the cosmetic intro phase — sim doesn't need log entries
  let state = { ...initState(), turn: "player" };
  let turns = 0;
  const moveCount = { engineer: {}, contractor: {} };

  while (!state.winner && turns < maxTurns) {
    if (state.turn === "player") {
      if (state.engStatus === STATUS.STUNNED) {
        state = reducer(state, { type: "PLAYER_STUNNED" });
      } else {
        const move = engPolicy(state, "engineer");
        moveCount.engineer[move.name] = (moveCount.engineer[move.name] || 0) + 1;
        state = reducer(state, { type: "PLAYER_MOVE", move });
      }
    } else if (state.turn === "enemy") {
      if (state.conStatus === STATUS.STUNNED) {
        state = reducer(state, { type: "ENEMY_MOVE" });
      } else {
        const move = conPolicy(state, "contractor");
        moveCount.contractor[move.name] = (moveCount.contractor[move.name] || 0) + 1;
        state = reducer(state, { type: "ENEMY_MOVE", move });
      }
    } else {
      throw new Error(`runGame: unexpected turn state '${state.turn}'`);
    }
    turns++;
  }

  return {
    winner: state.winner || "draw",
    turns,
    moveCount,
  };
}
