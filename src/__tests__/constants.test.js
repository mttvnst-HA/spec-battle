import { describe, it, expect } from "vitest";
import { C, STATUS, GAME, TIMINGS, rand, pick, clamp } from "../constants.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";

describe("Game Balance Constants (structural)", () => {
  it("has critRate as a number in [0, 1]", () => {
    expect(typeof GAME.critRate).toBe("number");
    expect(GAME.critRate).toBeGreaterThanOrEqual(0);
    expect(GAME.critRate).toBeLessThanOrEqual(1);
  });

  it("has critMultiplier as a positive number", () => {
    expect(typeof GAME.critMultiplier).toBe("number");
    expect(GAME.critMultiplier).toBeGreaterThan(0);
  });

  it("has mpRegen as a non-negative integer", () => {
    expect(Number.isInteger(GAME.mpRegen)).toBe(true);
    expect(GAME.mpRegen).toBeGreaterThanOrEqual(0);
  });

  it("has stunChance as a number in [0, 1]", () => {
    expect(typeof GAME.stunChance).toBe("number");
    expect(GAME.stunChance).toBeGreaterThanOrEqual(0);
    expect(GAME.stunChance).toBeLessThanOrEqual(1);
  });

  it("has slowChance as a number in [0, 1]", () => {
    expect(typeof GAME.slowChance).toBe("number");
    expect(GAME.slowChance).toBeGreaterThanOrEqual(0);
    expect(GAME.slowChance).toBeLessThanOrEqual(1);
  });

  it("has weakenedMultiplier as a positive number", () => {
    expect(typeof GAME.weakenedMultiplier).toBe("number");
    expect(GAME.weakenedMultiplier).toBeGreaterThan(0);
  });

  it("has defMultiplier as a positive number", () => {
    expect(typeof GAME.defMultiplier).toBe("number");
    expect(GAME.defMultiplier).toBeGreaterThan(0);
  });

  it("has healRange as a two-element integer array with min ≤ max", () => {
    expect(Array.isArray(GAME.healRange)).toBe(true);
    expect(GAME.healRange).toHaveLength(2);
    expect(Number.isInteger(GAME.healRange[0])).toBe(true);
    expect(Number.isInteger(GAME.healRange[1])).toBe(true);
    expect(GAME.healRange[0]).toBeLessThanOrEqual(GAME.healRange[1]);
    expect(GAME.healRange[0]).toBeGreaterThanOrEqual(0);
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
