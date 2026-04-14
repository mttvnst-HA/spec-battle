import { describe, it, expect, afterEach } from "vitest";
import { randomPolicy, aiPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { initState } from "../game/reducer.js";

afterEach(() => seed(null));

describe("randomPolicy", () => {
  it("returns an engineer move for side='engineer'", () => {
    seed(1);
    const move = randomPolicy(initState(), "engineer");
    expect(ENGINEER.moves).toContain(move);
  });

  it("returns a contractor move for side='contractor'", () => {
    seed(1);
    const move = randomPolicy(initState(), "contractor");
    expect(CONTRACTOR.moves).toContain(move);
  });

  it("only picks affordable moves", () => {
    seed(1);
    const s = { ...initState(), engMp: 5 };
    for (let i = 0; i < 100; i++) {
      const m = randomPolicy(s, "engineer");
      expect(m.mp).toBeLessThanOrEqual(5);
    }
  });

  it("is deterministic given a seed", () => {
    seed(42);
    const a = randomPolicy(initState(), "engineer");
    seed(42);
    const b = randomPolicy(initState(), "engineer");
    expect(a).toBe(b);
  });
});

describe("aiPolicy", () => {
  it("returns a contractor move", () => {
    const move = aiPolicy(initState(), "contractor");
    expect(CONTRACTOR.moves).toContain(move);
  });

  it("throws if called for engineer side", () => {
    expect(() => aiPolicy(initState(), "engineer")).toThrow();
  });
});
