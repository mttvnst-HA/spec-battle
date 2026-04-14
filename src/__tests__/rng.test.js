import { describe, it, expect, vi, afterEach } from "vitest";
import { seed, random, rand, pick } from "../game/rng.js";

afterEach(() => {
  seed(null);
  vi.restoreAllMocks();
});

describe("rng", () => {
  it("delegates to Math.random when unseeded", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    expect(random()).toBe(0.42);
  });

  it("produces deterministic sequences from a seed", () => {
    seed(12345);
    const a = [random(), random(), random()];
    seed(12345);
    const b = [random(), random(), random()];
    expect(a).toEqual(b);
  });

  it("different seeds produce different sequences", () => {
    seed(1);
    const a = random();
    seed(2);
    const b = random();
    expect(a).not.toBe(b);
  });

  it("seeded values are in [0, 1)", () => {
    seed(999);
    for (let i = 0; i < 1000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("rand returns integers in [a, b] inclusive", () => {
    seed(7);
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(rand(1, 3));
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it("pick returns an element from the array", () => {
    seed(7);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(pick(arr));
    }
  });

  it("seed(null) restores Math.random fallback", () => {
    seed(42);
    random();
    seed(null);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(random()).toBe(0.99);
  });
});
