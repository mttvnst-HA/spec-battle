import { describe, it, expect, vi } from "vitest";
import { calculateDamage, rollStatusEffect, resolveMove, pickAIMove } from "../game/logic.js";
import { STATUS, GAME } from "../constants.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";

describe("calculateDamage", () => {
  const move = { dmg: [20, 20], mp: 0, effect: null }; // fixed damage for predictability

  it("returns damage in expected range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no crit
    const { dmg, crit } = calculateDamage(move, null);
    expect(dmg).toBe(20);
    expect(crit).toBe(false);
    vi.restoreAllMocks();
  });

  it("applies DEF+ (50% reduction)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { dmg } = calculateDamage(move, STATUS.DEF_PLUS);
    expect(dmg).toBe(10); // 20 * 0.5
    vi.restoreAllMocks();
  });

  it("applies WEAKENED (30% increase)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { dmg } = calculateDamage(move, STATUS.WEAKENED);
    expect(dmg).toBe(26); // 20 * 1.3
    vi.restoreAllMocks();
  });

  it("applies crit multiplier", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01); // triggers crit (< 0.12)
    const { dmg, crit } = calculateDamage(move, null);
    expect(crit).toBe(true);
    expect(dmg).toBe(32); // 20 * 1.6
    vi.restoreAllMocks();
  });
});

describe("rollStatusEffect", () => {
  it("returns WEAKENED for weaken effect (always)", () => {
    expect(rollStatusEffect({ effect: "weaken" })).toBe(STATUS.WEAKENED);
  });

  it("returns STUNNED for stun effect when roll succeeds", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // < 0.3
    expect(rollStatusEffect({ effect: "stun" })).toBe(STATUS.STUNNED);
    vi.restoreAllMocks();
  });

  it("returns null for stun effect when roll fails", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // > 0.3
    expect(rollStatusEffect({ effect: "stun" })).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns SLOWED for slow effect when roll succeeds", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2); // < 0.4
    expect(rollStatusEffect({ effect: "slow" })).toBe(STATUS.SLOWED);
    vi.restoreAllMocks();
  });

  it("returns null for null effect", () => {
    expect(rollStatusEffect({ effect: null })).toBeNull();
  });

  it("returns null for defense effect", () => {
    expect(rollStatusEffect({ effect: "defense" })).toBeNull();
  });
});

describe("resolveMove", () => {
  const baseState = {
    engHp: 140, engMp: 70, conHp: 150, conMp: 60,
    engStatus: null, conStatus: null,
    engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
    log: [],
  };

  it("deducts MP from attacker", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const move = ENGINEER.moves.find(m => m.mp > 0);
    const result = resolveMove(baseState, ENGINEER, move, true);
    expect(result.engMp).toBe(70 - move.mp);
    vi.restoreAllMocks();
  });

  it("deals damage to defender", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const move = ENGINEER.moves[0]; // REJECT SUBMITTAL, no MP cost
    const result = resolveMove(baseState, ENGINEER, move, true);
    expect(result.conHp).toBeLessThan(150);
    vi.restoreAllMocks();
  });

  it("generates log entries", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const move = ENGINEER.moves[0];
    const result = resolveMove(baseState, ENGINEER, move, true);
    expect(result.log.length).toBeGreaterThanOrEqual(3); // action + quote + damage
    vi.restoreAllMocks();
  });

  it("heal move recovers HP and does not flash", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const healMove = CONTRACTOR.moves.find(m => m.effect === "heal");
    const lowHpState = { ...baseState, conHp: 50 };
    const result = resolveMove(lowHpState, CONTRACTOR, healMove, false);
    expect(result.conHp).toBeGreaterThan(50);
    expect(result.conFlash).toBe(0); // no flash on heal
    vi.restoreAllMocks();
  });

  it("defense move sets DEF+ on caster", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const defMove = ENGINEER.moves.find(m => m.effect === "defense");
    const result = resolveMove(baseState, ENGINEER, defMove, true);
    expect(result.engStatus).toBe(STATUS.DEF_PLUS);
    vi.restoreAllMocks();
  });
});

describe("pickAIMove", () => {
  it("heals when contractor HP is low", () => {
    const state = { conHp: 30, conMp: 60, conStatus: null, engHp: 100 };
    const move = pickAIMove(state);
    expect(move.effect).toBe("heal");
  });

  it("uses defense when weakened", () => {
    const state = { conHp: 100, conMp: 60, conStatus: STATUS.WEAKENED, engHp: 100 };
    const move = pickAIMove(state);
    expect(move.effect).toBe("defense");
  });

  it("uses big attack when engineer HP is low", () => {
    const state = { conHp: 100, conMp: 60, conStatus: null, engHp: 20 };
    const move = pickAIMove(state);
    expect(move.name).toBe("CLAIM DSC");
  });

  it("falls back to RFI when no MP", () => {
    const state = { conHp: 100, conMp: 0, conStatus: null, engHp: 100 };
    const move = pickAIMove(state);
    expect(move.name).toBe("SUBMIT RFI");
  });
});
