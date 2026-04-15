import { describe, it, expect } from "vitest";
import { runAveragedBatch } from "../sim/runAveragedBatch.js";
import { runBatch } from "../sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../sim/policies.js";

const commonArgs = {
  engPolicy: randomPolicy,
  conPolicy: randomPolicy,
  engPolicyName: "random",
  conPolicyName: "random",
};

describe("runAveragedBatch", () => {
  it("throws on seedChunks < 1", () => {
    expect(() =>
      runAveragedBatch({ startSeed: 1, count: 10, seedChunks: 0, ...commonArgs }),
    ).toThrow(/seedChunks/);
    expect(() =>
      runAveragedBatch({ startSeed: 1, count: 10, seedChunks: -1, ...commonArgs }),
    ).toThrow(/seedChunks/);
  });

  it("throws on non-integer seedChunks", () => {
    expect(() =>
      runAveragedBatch({ startSeed: 1, count: 10, seedChunks: 2.5, ...commonArgs }),
    ).toThrow(/seedChunks/);
  });

  it("passes through at seedChunks=1 (byte-identical to runBatch)", () => {
    const averaged = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 1,
      ...commonArgs,
    });
    const direct = runBatch({ startSeed: 1, count: 10, ...commonArgs });
    expect(averaged).toEqual(direct);
  });

  it("is deterministic (same args → same output)", () => {
    const a = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });
    const b = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });
    expect(a).toEqual(b);
  });

  it("averages engineerWinRate / avgTurns / drawRate / contractorWinRate across chunks", () => {
    const averaged = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });

    // Compute the reference by running the three chunks directly.
    const chunk0 = runBatch({ startSeed: 1, count: 10, ...commonArgs });
    const chunk1 = runBatch({ startSeed: 11, count: 10, ...commonArgs });
    const chunk2 = runBatch({ startSeed: 21, count: 10, ...commonArgs });

    const expectedWinRate = +(
      (chunk0.engineerWinRate + chunk1.engineerWinRate + chunk2.engineerWinRate) / 3
    ).toFixed(4);
    const expectedTurns = +(
      (chunk0.avgTurns + chunk1.avgTurns + chunk2.avgTurns) / 3
    ).toFixed(2);
    const expectedDraw = +(
      (chunk0.drawRate + chunk1.drawRate + chunk2.drawRate) / 3
    ).toFixed(4);
    const expectedConWin = +(
      (chunk0.contractorWinRate + chunk1.contractorWinRate + chunk2.contractorWinRate) / 3
    ).toFixed(4);

    expect(averaged.engineerWinRate).toBe(expectedWinRate);
    expect(averaged.avgTurns).toBe(expectedTurns);
    expect(averaged.drawRate).toBe(expectedDraw);
    expect(averaged.contractorWinRate).toBe(expectedConWin);
  });

  it("averages moveFrequency per-move across chunks (missing keys count as 0)", () => {
    const averaged = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });
    const chunk0 = runBatch({ startSeed: 1, count: 10, ...commonArgs });
    const chunk1 = runBatch({ startSeed: 11, count: 10, ...commonArgs });
    const chunk2 = runBatch({ startSeed: 21, count: 10, ...commonArgs });

    // Union of keys across all three chunks must appear in averaged output.
    const unionEng = new Set([
      ...Object.keys(chunk0.moveFrequency.engineer),
      ...Object.keys(chunk1.moveFrequency.engineer),
      ...Object.keys(chunk2.moveFrequency.engineer),
    ]);
    expect(new Set(Object.keys(averaged.moveFrequency.engineer))).toEqual(unionEng);

    // Every per-move value equals the mean across the three chunks
    // (missing → 0 contribution).
    for (const name of unionEng) {
      const v0 = chunk0.moveFrequency.engineer[name] ?? 0;
      const v1 = chunk1.moveFrequency.engineer[name] ?? 0;
      const v2 = chunk2.moveFrequency.engineer[name] ?? 0;
      const expected = +((v0 + v1 + v2) / 3).toFixed(4);
      expect(averaged.moveFrequency.engineer[name]).toBeCloseTo(expected, 4);
    }
  });

  it("returns aggregate count = count * seedChunks", () => {
    const averaged = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });
    expect(averaged.count).toBe(30);
  });

  it("preserves matchup + startSeed identity", () => {
    const averaged = runAveragedBatch({
      startSeed: 42,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });
    expect(averaged.matchup).toBe("random-vs-random");
    expect(averaged.startSeed).toBe(42);
  });

  it("uses disjoint seed ranges (different startSeed → different output)", () => {
    const a = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });
    const b = runAveragedBatch({
      startSeed: 100,
      count: 10,
      seedChunks: 3,
      ...commonArgs,
    });
    // Different seeds should produce different sampled winrates in a 30-game
    // batch. Assertion is defensive against a pathological match — probability
    // is astronomically low.
    expect(a.engineerWinRate).not.toBe(b.engineerWinRate);
  });

  it("works with the aiPolicy matchup (contractor side)", () => {
    const result = runAveragedBatch({
      startSeed: 1,
      count: 10,
      seedChunks: 2,
      engPolicy: randomPolicy,
      conPolicy: aiPolicy,
      engPolicyName: "random",
      conPolicyName: "ai",
    });
    expect(result.matchup).toBe("random-vs-ai");
    expect(result.count).toBe(20);
    expect(result.engineerWinRate).toBeGreaterThanOrEqual(0);
    expect(result.engineerWinRate).toBeLessThanOrEqual(1);
  });
});
