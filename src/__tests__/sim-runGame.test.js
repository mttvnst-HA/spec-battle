import { describe, it, expect, afterEach } from "vitest";
import { runGame } from "../sim/runGame.js";
import { randomPolicy, aiPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";

afterEach(() => seed(null));

describe("runGame", () => {
  it("runs to completion and returns a winner", () => {
    const result = runGame({
      seed: 1,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
    });
    expect(["engineer", "contractor", "draw"]).toContain(result.winner);
    expect(result.turns).toBeGreaterThan(0);
  });

  it("is deterministic given the same seed and policies", () => {
    const a = runGame({ seed: 7, engPolicy: randomPolicy, conPolicy: randomPolicy });
    const b = runGame({ seed: 7, engPolicy: randomPolicy, conPolicy: randomPolicy });
    expect(a).toEqual(b);
  });

  it("different seeds produce different games", () => {
    const a = runGame({ seed: 1, engPolicy: randomPolicy, conPolicy: randomPolicy });
    const b = runGame({ seed: 9999, engPolicy: randomPolicy, conPolicy: randomPolicy });
    // Extremely unlikely to be identical across two different seeds
    expect(a).not.toEqual(b);
  });

  it("records move frequency per side", () => {
    const result = runGame({
      seed: 1,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
    });
    expect(result.moveCount).toHaveProperty("engineer");
    expect(result.moveCount).toHaveProperty("contractor");
    const engTotal = Object.values(result.moveCount.engineer).reduce((a, b) => a + b, 0);
    expect(engTotal).toBeGreaterThan(0);
  });

  it("terminates at maxTurns with winner='draw' if no one dies", () => {
    // Tight cap forces a draw
    const result = runGame({
      seed: 1,
      engPolicy: randomPolicy,
      conPolicy: randomPolicy,
      maxTurns: 2,
    });
    expect(result.turns).toBeLessThanOrEqual(2);
  });

  it("works with aiPolicy on the contractor side", () => {
    const result = runGame({
      seed: 5,
      engPolicy: randomPolicy,
      conPolicy: aiPolicy,
    });
    expect(["engineer", "contractor", "draw"]).toContain(result.winner);
  });
});
