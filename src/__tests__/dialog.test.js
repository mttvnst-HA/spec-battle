import { describe, it, expect, beforeEach } from "vitest";
import { pickDialog, vsKey } from "../game/dialog.js";
import { seed } from "../game/rng.js";

describe("vsKey", () => {
  it("normalizes a simple move name", () => {
    expect(vsKey("INVOKE SHALL")).toBe("vs_INVOKE_SHALL");
  });

  it("normalizes hyphens and spaces", () => {
    expect(vsKey("OR-EQUAL GAMBIT")).toBe("vs_OR_EQUAL_GAMBIT");
    expect(vsKey("RED-LINE SPEC")).toBe("vs_RED_LINE_SPEC");
  });

  it("preserves case", () => {
    expect(vsKey("Foo-Bar Baz")).toBe("vs_Foo_Bar_Baz");
  });
});

describe("pickDialog", () => {
  const move = {
    name: "REJECT SUBMITTAL",
    quotes: {
      default: ["default line a", "default line b"],
      opening: ["opening line"],
      vs_SUBMIT_RFI: ["rfi-specific line a", "rfi-specific line b"],
    },
  };

  beforeEach(() => seed(1));

  it("picks from opening bucket when isOpening is true", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: null, isOpening: true });
    expect(q).toBe("opening line");
  });

  it("picks from opening when both isOpening AND opponentLastMove are present (opening wins)", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: true });
    expect(q).toBe("opening line");
  });

  it("picks from vs_<OPPONENT_MOVE> bucket when it exists", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: false });
    expect(["rfi-specific line a", "rfi-specific line b"]).toContain(q);
  });

  it("falls back to default when vs bucket missing", () => {
    const q = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "CLAIM DSC", isOpening: false });
    expect(["default line a", "default line b"]).toContain(q);
  });

  it("falls back to default when opening requested but empty", () => {
    const noOpening = { name: "X", quotes: { default: ["d"] } };
    const q = pickDialog({ attackerSide: "engineer", move: noOpening, opponentLastMove: null, isOpening: true });
    expect(q).toBe("d");
  });

  it("is deterministic under a seeded RNG", () => {
    seed(42);
    const a = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: false });
    seed(42);
    const b = pickDialog({ attackerSide: "engineer", move, opponentLastMove: "SUBMIT RFI", isOpening: false });
    expect(a).toBe(b);
  });

  it("handles moves where quotes is still a flat array (legacy support)", () => {
    const legacy = { name: "X", quotes: ["legacy a", "legacy b"] };
    const q = pickDialog({ attackerSide: "engineer", move: legacy, opponentLastMove: null, isOpening: false });
    expect(["legacy a", "legacy b"]).toContain(q);
  });
});
