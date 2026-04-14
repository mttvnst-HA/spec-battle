import { describe, it, expect } from "vitest";
import { isConverged, isImprovement, worst, distance } from "../tune/convergence.js";

// Helper to build a two-matchup report compactly.
const r = (eng1, eng2) => ({
  matchups: [
    { matchup: "random-vs-random", engineerWinRate: eng1, contractorWinRate: 1 - eng1 },
    { matchup: "random-vs-ai",     engineerWinRate: eng2, contractorWinRate: 1 - eng2 },
  ],
});

describe("distance / worst", () => {
  it("distance is |engineerWinRate - 0.5|", () => {
    expect(distance(r(0.86, 0.5).matchups[0])).toBeCloseTo(0.36);
    expect(distance(r(0.86, 0.5).matchups[1])).toBeCloseTo(0.0);
  });

  it("worst is max distance across matchups", () => {
    expect(worst(r(0.86, 0.55))).toBeCloseTo(0.36);
    expect(worst(r(0.55, 0.86))).toBeCloseTo(0.36);
    expect(worst(r(0.5, 0.5))).toBeCloseTo(0.0);
  });
});

describe("isConverged", () => {
  it("returns false for fewer than 3 reports", () => {
    expect(isConverged([])).toBe(false);
    expect(isConverged([r(0.5, 0.5)])).toBe(false);
    expect(isConverged([r(0.5, 0.5), r(0.5, 0.5)])).toBe(false);
  });

  it("returns true when last 3 reports have both matchups in [0.45, 0.55]", () => {
    const hist = [r(0.86, 0.72), r(0.50, 0.50), r(0.46, 0.55), r(0.54, 0.45)];
    expect(isConverged(hist)).toBe(true);
  });

  it("returns false if any of the last 3 has a matchup outside band", () => {
    const hist = [r(0.50, 0.50), r(0.50, 0.50), r(0.46, 0.56)];
    expect(isConverged(hist)).toBe(false);
  });

  it("ignores reports older than the last 3", () => {
    const hist = [r(0.90, 0.90), r(0.50, 0.50), r(0.50, 0.50), r(0.50, 0.50)];
    expect(isConverged(hist)).toBe(true);
  });
});

describe("isImprovement", () => {
  it("true when worst strictly decreases and no matchup regresses >2pp", () => {
    expect(isImprovement(r(0.86, 0.72), r(0.80, 0.72))).toBe(true);
  });

  it("false when worst does not strictly decrease", () => {
    expect(isImprovement(r(0.86, 0.72), r(0.86, 0.72))).toBe(false);
    expect(isImprovement(r(0.86, 0.72), r(0.86, 0.70))).toBe(false); // 86 is still worst
  });

  it("false when any matchup regresses by more than 2pp", () => {
    // worst drops (86->80), but matchup 2 regresses by 3pp
    expect(isImprovement(r(0.86, 0.72), r(0.80, 0.75))).toBe(false);
  });

  it("true when a matchup regresses by exactly 2pp (inclusive)", () => {
    expect(isImprovement(r(0.86, 0.72), r(0.80, 0.74))).toBe(true);
  });
});
