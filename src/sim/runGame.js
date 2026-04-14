import { reducer, initState } from "../game/reducer.js";
import { seed } from "../game/rng.js";
import { STATUS } from "../constants.js";

const DEFAULT_MAX_TURNS = 500;

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
      // Defensive: any unexpected turn state ends the loop
      break;
    }
    turns++;
  }

  return {
    winner: state.winner || "draw",
    turns,
    moveCount,
  };
}
