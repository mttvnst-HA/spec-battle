import { describe, it, expect } from "vitest";
import { COUNTER_ROUTING, isCounter, getCounterEntry } from "../game/counters.js";

describe("COUNTER_ROUTING table", () => {
  it("has 13 entries", () => {
    expect(COUNTER_ROUTING).toHaveLength(13);
  });

  it("every entry has initiator, counterer, counterMove", () => {
    COUNTER_ROUTING.forEach((e) => {
      expect(e).toHaveProperty("initiator");
      expect(e).toHaveProperty("counterer");
      expect(e).toHaveProperty("counterMove");
      expect(["engineer", "contractor"]).toContain(e.counterer);
    });
  });
});

describe("isCounter", () => {
  it("returns true for a canonical engineer counter", () => {
    expect(isCounter("engineer", "INVOKE SHALL", "OR-EQUAL GAMBIT")).toBe(true);
  });

  it("returns true for a canonical contractor counter", () => {
    expect(isCounter("contractor", "SUBMIT RFI", "INVOKE SHALL")).toBe(true);
  });

  it("returns false when side is wrong", () => {
    expect(isCounter("contractor", "INVOKE SHALL", "OR-EQUAL GAMBIT")).toBe(false);
  });

  it("returns false when opponent last move doesn't match", () => {
    expect(isCounter("engineer", "INVOKE SHALL", "SUBMIT RFI")).toBe(false);
  });

  it("returns false when opponent last move is null", () => {
    expect(isCounter("engineer", "INVOKE SHALL", null)).toBe(false);
  });

  it("returns false for unknown move names", () => {
    expect(isCounter("engineer", "MAKE COFFEE", "OR-EQUAL GAMBIT")).toBe(false);
  });
});

describe("getCounterEntry", () => {
  it("returns the matching entry for a counter", () => {
    const entry = getCounterEntry("engineer", "INVOKE SHALL", "OR-EQUAL GAMBIT");
    expect(entry).not.toBeNull();
    expect(entry.initiator).toBe("OR-EQUAL GAMBIT");
    expect(entry.counterMove).toBe("INVOKE SHALL");
  });

  it("returns null when no counter matches", () => {
    expect(getCounterEntry("engineer", "INVOKE SHALL", "SUBMIT RFI")).toBeNull();
  });
});
