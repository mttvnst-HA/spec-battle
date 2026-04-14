import { describe, it, expect } from "vitest";
import { C, STATUS, GAME, TIMINGS, rand, pick, clamp } from "../constants.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";

describe("Game Balance Constants", () => {
  it("crit rate is 12%", () => {
    expect(GAME.critRate).toBe(0.12);
  });

  it("crit multiplier is 1.6x", () => {
    expect(GAME.critMultiplier).toBe(1.6);
  });

  it("MP regen is 4 per turn", () => {
    expect(GAME.mpRegen).toBe(4);
  });

  it("stun chance is 30%", () => {
    expect(GAME.stunChance).toBe(0.3);
  });

  it("slow chance is 40%", () => {
    expect(GAME.slowChance).toBe(0.4);
  });

  it("weakened multiplier is 1.3x", () => {
    expect(GAME.weakenedMultiplier).toBe(1.3);
  });

  it("defense multiplier is 0.5x", () => {
    expect(GAME.defMultiplier).toBe(0.5);
  });

  it("heal range is [28, 45]", () => {
    expect(GAME.healRange).toEqual([28, 45]);
  });
});

describe("STATUS Enum", () => {
  it("has all expected values", () => {
    expect(STATUS.STUNNED).toBe("STUNNED");
    expect(STATUS.WEAKENED).toBe("WEAKENED");
    expect(STATUS.DEF_PLUS).toBe("DEF+");
    expect(STATUS.SLOWED).toBe("SLOWED");
  });
});

describe("Character Stats", () => {
  it("Engineer has 140 HP / 70 MP", () => {
    expect(ENGINEER.maxHp).toBe(140);
    expect(ENGINEER.maxMp).toBe(70);
  });

  it("Contractor has 150 HP / 60 MP", () => {
    expect(CONTRACTOR.maxHp).toBe(150);
    expect(CONTRACTOR.maxMp).toBe(60);
  });

  it("both characters have mpRegen matching GAME config", () => {
    expect(ENGINEER.mpRegen).toBe(GAME.mpRegen);
    expect(CONTRACTOR.mpRegen).toBe(GAME.mpRegen);
  });
});

describe("Utility Functions", () => {
  it("rand returns value in range", () => {
    for (let i = 0; i < 100; i++) {
      const v = rand(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it("pick returns element from array", () => {
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(pick(arr));
    }
  });

  it("clamp constrains value", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("Color Palette", () => {
  it("all colors are hex strings", () => {
    Object.values(C).forEach((color) => {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });
});
