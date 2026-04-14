import { C, STATUS, GAME, clamp } from "../constants.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { resolveMove, pickAIMove, applyOwnerPayment } from "./logic.js";

export const INTRO_SEQUENCE = [
  { entry: { text: "A wild CONTRACTOR appeared on the jobsite!", color: C.yellow }, delay: 0 },
  { entry: { text: '  "We\'re here in a spirit of partnering and collaboration."', color: C.white }, delay: 1200 },
  { entry: { text: "CONTRACTOR slides a submittal package across the table...", color: C.orange }, delay: 2000 },
  { entry: { text: "The QC stamp is from a company that no longer exists.", color: C.orange }, delay: 1800 },
  { entry: { text: "Choose your response, ENGINEER.", color: C.bright }, delay: 1500 },
];

export const initState = () => ({
  engHp: ENGINEER.maxHp, engMp: ENGINEER.maxMp,
  conHp: CONTRACTOR.maxHp, conMp: CONTRACTOR.maxMp,
  engStatus: null, conStatus: null,
  log: [],
  turn: "intro", busy: false,
  engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
  winner: null,
  ownerBudget: GAME.ownerBudget,
  conProfits: 0,
  walkOffUnlocked: false,
});

function checkWinner(s, isPlayer) {
  if (isPlayer && s.conHp <= 0) return { ...s, busy: true, winner: "engineer" };
  if (!isPlayer && s.engHp <= 0) return { ...s, busy: true, winner: "contractor" };
  return null;
}

export function reducer(state, action) {
  switch (action.type) {
    case "INTRO_LOG": {
      if (state.turn !== "intro") return state;
      return { ...state, log: [...state.log, action.entry] };
    }
    case "INTRO_DONE": {
      if (state.turn !== "intro") return state;
      return { ...state, turn: "player" };
    }
    case "PLAYER_STUNNED": {
      if (state.turn !== "player" || state.engStatus !== STATUS.STUNNED) return state;
      return {
        ...state, engStatus: null, turn: "enemy", busy: true,
        log: [...state.log, { text: "ENGINEER is stunned! Turn skipped!", color: C.yellow }],
      };
    }
    case "PLAYER_MOVE": {
      const move = action.move;
      if (state.turn !== "player" || state.busy) return state;
      if (state.engStatus === STATUS.STUNNED) return state;
      if (move.mp > state.engMp) {
        return { ...state, log: [...state.log, { text: "Not enough MP!", color: C.red }] };
      }
      let s = resolveMove(state, ENGINEER, move, true);
      s.engMp = clamp(s.engMp + ENGINEER.mpRegen, 0, ENGINEER.maxMp);
      if (s.conStatus === STATUS.DEF_PLUS) s.conStatus = null;
      const win = checkWinner(s, true);
      if (win) return win;
      s = applyOwnerPayment(s, true);
      return { ...s, turn: "enemy", busy: true };
    }
    case "ENEMY_MOVE": {
      if (state.turn !== "enemy") return state;
      if (state.conStatus === STATUS.STUNNED) {
        return {
          ...state, conStatus: null, turn: "player", busy: false,
          log: [...state.log, { text: "CONTRACTOR is stunned! Turn skipped!", color: C.yellow }],
        };
      }
      const move = pickAIMove(state);
      let s = resolveMove(state, CONTRACTOR, move, false);
      s.conMp = clamp(s.conMp + CONTRACTOR.mpRegen, 0, CONTRACTOR.maxMp);
      if (s.engStatus === STATUS.DEF_PLUS) s.engStatus = null;
      const win = checkWinner(s, false);
      if (win) return win;
      s = applyOwnerPayment(s, false);
      if (!s.walkOffUnlocked && s.conProfits >= GAME.walkOffThreshold) {
        s.walkOffUnlocked = true;
        s.log = [...s.log, { text: "!! CONTRACTOR profits threshold reached. WALK OFF THREAT unlocked !!", color: C.red }];
      }
      return { ...s, turn: "player", busy: false };
    }
    case "RESET": return initState();
    default: return state;
  }
}
