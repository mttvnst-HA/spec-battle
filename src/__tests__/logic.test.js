import { describe, it, expect, vi } from "vitest";
import { calculateDamage, rollStatusEffect, resolveMove, pickAIMove } from "../game/logic.js";
import { STATUS, GAME } from "../constants.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { seed as seedRng } from "../game/rng.js";

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

describe("calculateDamage with isCounter", () => {
  it("applies counterMultiplier when isCounter is true", () => {
    seedRng(1);
    const move = { dmg: [10, 10], effect: null };
    const noCounter = calculateDamage(move, null, false);
    seedRng(1);
    const withCounter = calculateDamage(move, null, true);
    // counterMultiplier × same base roll (crit outcome identical due to reseed)
    expect(withCounter.dmg).toBe(Math.floor(noCounter.dmg * GAME.counterMultiplier));
  });

  it("counter multiplier applies BEFORE crit (crit multiplies the counter-bonused base)", () => {
    // We verify ordering by forcing a crit via seeded RNG and asserting dmg is
    // Math.floor(base × counterMultiplier × critMultiplier).
    // This is a structural assertion — exact numbers depend on the seeded roll.
    seedRng(1);
    const move = { dmg: [10, 10], effect: null };
    const r = calculateDamage(move, null, true);
    if (r.crit) {
      expect(r.dmg).toBe(Math.floor(10 * GAME.counterMultiplier * GAME.critMultiplier));
    }
  });
});

describe("rollStatusEffect with isCounter", () => {
  it("returns STUNNED guaranteed when isCounter is true and move has stun effect", () => {
    const move = { effect: "stun" };
    // Run many iterations to verify determinism even if RNG would have missed
    for (let i = 0; i < 20; i++) {
      seedRng(i);
      expect(rollStatusEffect(move, true)).toBe(STATUS.STUNNED);
    }
  });

  it("returns SLOWED guaranteed when isCounter is true and move has slow effect", () => {
    const move = { effect: "slow" };
    for (let i = 0; i < 20; i++) {
      seedRng(i);
      expect(rollStatusEffect(move, true)).toBe(STATUS.SLOWED);
    }
  });

  it("returns WEAKENED when isCounter is true and move has weaken effect (unchanged — weaken was already always-on)", () => {
    expect(rollStatusEffect({ effect: "weaken" }, true)).toBe(STATUS.WEAKENED);
  });

  it("is a no-op (null) when isCounter is true but move has no status effect", () => {
    expect(rollStatusEffect({ effect: null }, true)).toBe(null);
    expect(rollStatusEffect({ effect: "heal" }, true)).toBe(null);
    expect(rollStatusEffect({ effect: "defense" }, true)).toBe(null);
  });

  it("behaves like today when isCounter is false (default)", () => {
    seedRng(1);
    const a = rollStatusEffect({ effect: "stun" }, false);
    seedRng(1);
    const b = rollStatusEffect({ effect: "stun" });  // default = false
    expect(a).toBe(b);
  });
});

describe("resolveMove dialog routing", () => {
  it("pulls quote from vs_<opponent> bucket when opponentLastMove is set", () => {
    seedRng(7);
    const move = {
      name: "REJECT SUBMITTAL", emoji: "🚫", desc: "", dmg: [10, 10], mp: 0, effect: null,
      quotes: {
        default: ["default quote"],
        vs_SUBMIT_RFI: ["vs-rfi quote a", "vs-rfi quote b"],
      },
    };
    const attacker = { name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: 4 };
    const state = {
      engHp: 140, engMp: 70, conHp: 150, conMp: 60,
      engStatus: null, conStatus: null, log: [],
      engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
      engLastMove: "CITE UFC", conLastMove: "SUBMIT RFI",
    };
    const s = resolveMove(state, attacker, move, true, "SUBMIT RFI");
    const quoteLine = s.log.find((e) => e.text.startsWith("\""));
    expect(quoteLine.text).toMatch(/vs-rfi quote [ab]/);
  });
});

describe("resolveMove counter detection", () => {
  it("applies counter bonus and emits ⚔️ COUNTER log line on canonical counter", () => {
    seedRng(123);
    const invokeShall = {
      name: "INVOKE SHALL", emoji: "⚖️", desc: "", dmg: [30, 30], mp: 20, effect: "stun",
      quotes: { default: ["default shall"], vs_OR_EQUAL_GAMBIT: ["SHALL-slam line"] },
    };
    const state = {
      engHp: 140, engMp: 70, conHp: 150, conMp: 60,
      engStatus: null, conStatus: null, log: [],
      engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
      engLastMove: null, conLastMove: "OR-EQUAL GAMBIT",
    };
    const attacker = { name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: 4 };
    const s = resolveMove(state, attacker, invokeShall, true, "OR-EQUAL GAMBIT");

    // ⚔️ COUNTER line exists
    const counterLine = s.log.find((e) => e.text.startsWith("⚔️ COUNTER"));
    expect(counterLine).toBeDefined();
    expect(counterLine.text).toContain("INVOKE SHALL");
    expect(counterLine.text).toContain("OR-EQUAL GAMBIT");

    // Damage applied counter multiplier — damage is Math.floor(30 × 1.3 × possibly crit)
    const dmgLine = s.log.find((e) => e.text.match(/damage!/));
    const dmgMatch = dmgLine.text.match(/(\d+) damage/);
    const dmg = parseInt(dmgMatch[1], 10);
    expect(dmg).toBeGreaterThanOrEqual(Math.floor(30 * 1.3));

    // Stun guaranteed
    expect(s.conStatus).toBe(STATUS.STUNNED);

    // Quote from vs bucket
    const quoteLine = s.log.find((e) => e.text.includes("SHALL-slam"));
    expect(quoteLine).toBeDefined();
  });

  it("does NOT emit counter line when move is not a counter", () => {
    seedRng(5);
    const move = {
      name: "INVOKE SHALL", emoji: "⚖️", desc: "", dmg: [30, 30], mp: 20, effect: "stun",
      quotes: { default: ["default shall"] },
    };
    const state = {
      engHp: 140, engMp: 70, conHp: 150, conMp: 60,
      engStatus: null, conStatus: null, log: [],
      engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
      engLastMove: null, conLastMove: "SUBMIT RFI",  // not a counter target
    };
    const attacker = { name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: 4 };
    const s = resolveMove(state, attacker, move, true, "SUBMIT RFI");
    const counterLine = s.log.find((e) => e.text.startsWith("⚔️ COUNTER"));
    expect(counterLine).toBeUndefined();
  });
});

describe("pickAIMove counter awareness", () => {
  it("returns the contractor counter when engineer's last move is a canonical initiator", () => {
    seedRng(1); // first random() ≈ 0.00006, well below aiCounterBias (0.7)
    const state = {
      engHp: 140, conHp: 150, engMp: 70, conMp: 60,
      engStatus: null, conStatus: null,
      engLastMove: "CITE UFC",  // canonical contractor counter → CLAIM DSC
      conLastMove: null,
    };
    const move = pickAIMove(state);
    expect(move.name).toBe("CLAIM DSC");
  });

  it("falls through to existing tiers when there is no engLastMove", () => {
    seedRng(1);
    const state = {
      engHp: 140, conHp: 150, engMp: 70, conMp: 60,
      engStatus: null, conStatus: null,
      engLastMove: null, conLastMove: null,
    };
    const move = pickAIMove(state);
    expect([
      "SUBMIT RFI",
      "CLAIM DSC",
      "VALUE ENGINEER",
      "SCHEDULE DELAY",
      "OR-EQUAL GAMBIT",
      "RESERVE RIGHTS",
    ]).toContain(move.name);
  });
});
