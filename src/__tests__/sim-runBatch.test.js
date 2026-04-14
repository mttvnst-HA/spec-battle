import { describe, it, expect, afterEach } from "vitest";
import { runBatch } from "../sim/runBatch.js";
import { randomPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";

afterEach(() => seed(null));

describe("runBatch", () => {
  it("returns a BalanceReport with the expected shape", () => {
    const report = runBatch({
      startSeed: 1,
      count: 10,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
      engPolicyName: "random",
      conPolicyName: "random",
    });
    expect(report.matchup).toBe("random-vs-random");
    expect(report.startSeed).toBe(1);
    expect(report.count).toBe(10);
    expect(report.engineerWinRate).toBeGreaterThanOrEqual(0);
    expect(report.engineerWinRate).toBeLessThanOrEqual(1);
    expect(report.contractorWinRate).toBeGreaterThanOrEqual(0);
    expect(report.drawRate).toBeGreaterThanOrEqual(0);
    expect(report.avgTurns).toBeGreaterThan(0);
    expect(report.moveFrequency).toHaveProperty("engineer");
    expect(report.moveFrequency).toHaveProperty("contractor");
  });

  it("win rates + draw rate sum to 1", () => {
    const r = runBatch({
      startSeed: 1, count: 20,
      engPolicy: randomPolicy, conPolicy: randomPolicy,
      engPolicyName: "random", conPolicyName: "random",
    });
    expect(r.engineerWinRate + r.contractorWinRate + r.drawRate).toBeCloseTo(1, 4);
  });

  it("move frequencies per side sum to 1", () => {
    const r = runBatch({
      startSeed: 1, count: 20,
      engPolicy: randomPolicy, conPolicy: randomPolicy,
      engPolicyName: "random", conPolicyName: "random",
    });
    const engSum = Object.values(r.moveFrequency.engineer).reduce((a, b) => a + b, 0);
    const conSum = Object.values(r.moveFrequency.contractor).reduce((a, b) => a + b, 0);
    expect(engSum).toBeCloseTo(1, 2);
    expect(conSum).toBeCloseTo(1, 2);
  });

  it("is deterministic for identical input", () => {
    const args = {
      startSeed: 3, count: 10,
      engPolicy: randomPolicy, conPolicy: randomPolicy,
      engPolicyName: "random", conPolicyName: "random",
    };
    expect(runBatch(args)).toEqual(runBatch(args));
  });

  it("throws if count <= 0", () => {
    const args = {
      startSeed: 1,
      engPolicy: randomPolicy, conPolicy: randomPolicy,
      engPolicyName: "random", conPolicyName: "random",
    };
    expect(() => runBatch({ ...args, count: 0 })).toThrow();
    expect(() => runBatch({ ...args, count: -1 })).toThrow();
  });
});
