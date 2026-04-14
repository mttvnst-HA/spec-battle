import { describe, it, expect, vi } from "vitest";
import { reducer, initState } from "../game/reducer.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { STATUS } from "../constants.js";

describe("Reducer", () => {
  describe("initState", () => {
    it("starts with correct HP/MP", () => {
      const s = initState();
      expect(s.engHp).toBe(ENGINEER.maxHp);
      expect(s.engMp).toBe(ENGINEER.maxMp);
      expect(s.conHp).toBe(CONTRACTOR.maxHp);
      expect(s.conMp).toBe(CONTRACTOR.maxMp);
    });

    it("starts in intro phase", () => {
      const s = initState();
      expect(s.turn).toBe("intro");
    });

    it("starts with empty log", () => {
      const s = initState();
      expect(s.log).toEqual([]);
    });

    it("starts with no winner", () => {
      const s = initState();
      expect(s.winner).toBeNull();
    });
  });

  describe("INTRO_LOG", () => {
    it("appends entry to log during intro", () => {
      const s = initState();
      const entry = { text: "Test", color: "#fff" };
      const next = reducer(s, { type: "INTRO_LOG", entry });
      expect(next.log).toHaveLength(1);
      expect(next.log[0]).toEqual(entry);
    });

    it("ignores when not in intro", () => {
      const s = { ...initState(), turn: "player" };
      const next = reducer(s, { type: "INTRO_LOG", entry: { text: "X", color: "#fff" } });
      expect(next.log).toHaveLength(0);
    });
  });

  describe("INTRO_DONE", () => {
    it("transitions to player turn", () => {
      const s = initState();
      const next = reducer(s, { type: "INTRO_DONE" });
      expect(next.turn).toBe("player");
    });
  });

  describe("PLAYER_MOVE", () => {
    const playerState = () => ({ ...initState(), turn: "player" });

    it("deals damage and switches to enemy turn", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const move = ENGINEER.moves[0]; // REJECT SUBMITTAL, 0 MP
      const next = reducer(playerState(), { type: "PLAYER_MOVE", move });
      expect(next.conHp).toBeLessThan(CONTRACTOR.maxHp);
      expect(next.turn).toBe("enemy");
      expect(next.busy).toBe(true);
      vi.restoreAllMocks();
    });

    it("rejects when not enough MP", () => {
      const s = { ...playerState(), engMp: 0 };
      const expensiveMove = ENGINEER.moves.find(m => m.mp > 0);
      const next = reducer(s, { type: "PLAYER_MOVE", move: expensiveMove });
      // Should stay on player turn, log shows error
      expect(next.turn).toBe("player");
      expect(next.log[next.log.length - 1].text).toContain("Not enough MP");
    });

    it("rejects when stunned", () => {
      const s = { ...playerState(), engStatus: STATUS.STUNNED };
      const move = ENGINEER.moves[0];
      const next = reducer(s, { type: "PLAYER_MOVE", move });
      // State unchanged
      expect(next).toEqual(s);
    });

    it("regens engineer MP on player turn", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const s = { ...playerState(), engMp: 50 };
      const move = ENGINEER.moves[0]; // 0 MP cost
      const next = reducer(s, { type: "PLAYER_MOVE", move });
      expect(next.engMp).toBe(50 + ENGINEER.mpRegen);
      vi.restoreAllMocks();
    });

    it("detects engineer victory when contractor HP reaches 0", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const s = { ...playerState(), conHp: 1 };
      const move = ENGINEER.moves[0]; // will deal > 1 damage
      const next = reducer(s, { type: "PLAYER_MOVE", move });
      expect(next.conHp).toBe(0);
      expect(next.winner).toBe("engineer");
      vi.restoreAllMocks();
    });

    it("clears contractor DEF+ after player attacks", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const s = { ...playerState(), conStatus: STATUS.DEF_PLUS };
      const move = ENGINEER.moves[0];
      const next = reducer(s, { type: "PLAYER_MOVE", move });
      expect(next.conStatus).toBeNull();
      vi.restoreAllMocks();
    });
  });

  describe("PLAYER_STUNNED", () => {
    it("skips turn and clears stun", () => {
      const s = { ...initState(), turn: "player", engStatus: STATUS.STUNNED };
      const next = reducer(s, { type: "PLAYER_STUNNED" });
      expect(next.turn).toBe("enemy");
      expect(next.engStatus).toBeNull();
      expect(next.busy).toBe(true);
    });

    it("ignores when not stunned", () => {
      const s = { ...initState(), turn: "player", engStatus: null };
      const next = reducer(s, { type: "PLAYER_STUNNED" });
      expect(next).toEqual(s);
    });
  });

  describe("ENEMY_MOVE", () => {
    const enemyState = () => ({ ...initState(), turn: "enemy" });

    it("deals damage and switches to player turn", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const next = reducer(enemyState(), { type: "ENEMY_MOVE" });
      expect(next.engHp).toBeLessThan(ENGINEER.maxHp);
      expect(next.turn).toBe("player");
      expect(next.busy).toBe(false);
      vi.restoreAllMocks();
    });

    it("skips when contractor is stunned", () => {
      const s = { ...enemyState(), conStatus: STATUS.STUNNED };
      const next = reducer(s, { type: "ENEMY_MOVE" });
      expect(next.conStatus).toBeNull();
      expect(next.turn).toBe("player");
    });

    it("regens contractor MP on enemy turn", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const s = { ...enemyState(), conMp: 40 };
      const next = reducer(s, { type: "ENEMY_MOVE" });
      // MP should be 40 - move cost + regen
      expect(next.conMp).toBeGreaterThanOrEqual(40 - 15 + CONTRACTOR.mpRegen);
      vi.restoreAllMocks();
    });

    it("detects contractor victory when engineer HP reaches 0", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const s = { ...enemyState(), engHp: 1 };
      const next = reducer(s, { type: "ENEMY_MOVE" });
      expect(next.engHp).toBe(0);
      expect(next.winner).toBe("contractor");
      vi.restoreAllMocks();
    });

    it("clears engineer DEF+ after enemy attacks", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const s = { ...enemyState(), engStatus: STATUS.DEF_PLUS };
      const next = reducer(s, { type: "ENEMY_MOVE" });
      expect(next.engStatus).toBeNull();
      vi.restoreAllMocks();
    });
  });

  describe("ENEMY_MOVE with explicit move override", () => {
    it("uses action.move when provided instead of pickAIMove", () => {
      const s = { ...initState(), turn: "enemy", busy: true };
      const explicitMove = CONTRACTOR.moves[0]; // SUBMIT RFI
      const next = reducer(s, { type: "ENEMY_MOVE", move: explicitMove });
      // Move was used: contractor MP decreased by that move's cost (after regen)
      const expectedMp = Math.min(CONTRACTOR.maxMp, CONTRACTOR.maxMp - explicitMove.mp + CONTRACTOR.mpRegen);
      expect(next.conMp).toBe(expectedMp);
      expect(next.turn).toBe("player");
    });

    it("falls back to pickAIMove when action.move is absent", () => {
      const s = { ...initState(), turn: "enemy", busy: true };
      const next = reducer(s, { type: "ENEMY_MOVE" });
      // Should still advance — exact move not asserted (picked by pickAIMove)
      expect(next.turn).toBe("player");
    });
  });

  describe("RESET", () => {
    it("returns to initial state", () => {
      const s = {
        ...initState(), turn: "player", engHp: 50, conHp: 30,
        log: [{ text: "stuff", color: "#fff" }], winner: "engineer",
      };
      const next = reducer(s, { type: "RESET" });
      expect(next.engHp).toBe(ENGINEER.maxHp);
      expect(next.conHp).toBe(CONTRACTOR.maxHp);
      expect(next.turn).toBe("intro");
      expect(next.winner).toBeNull();
      expect(next.log).toEqual([]);
    });
  });
});
