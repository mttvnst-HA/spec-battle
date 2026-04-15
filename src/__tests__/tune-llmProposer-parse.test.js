import { describe, it, expect } from "vitest";
import { parseBundle } from "../tune/llmProposer.js";

const state = {
  GAME: {
    critRate: 0.12,
    critMultiplier: 1.6,
    mpRegen: 4,
    healRange: [28, 45],
    weakenedMultiplier: 1.3,
    counterMultiplier: 1.3,
    aiCounterBias: 0.7,
  },
  moves: {
    engineer: [{ name: "REJECT SUBMITTAL", dmg: [16, 24], mp: 10 }],
    contractor: [{ name: "CLAIM DSC", dmg: [18, 28], mp: 12 }],
  },
};

// Build a CLI envelope shape: {"type":"result","subtype":"success","result":"<inner>"}
const envelope = (inner) => JSON.stringify({ type: "result", subtype: "success", result: inner });

const validBundle = {
  rule: "llm-test",
  summary: "tweak critRate down",
  targets: [{ target: "GAME.critRate", before: 0.12, after: 0.10 }],
};

describe("parseBundle — happy path", () => {
  it("accepts a valid bundle from a CLI envelope with JSON result", () => {
    const raw = envelope(JSON.stringify(validBundle));
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
    expect(r.bundle).toEqual(validBundle);
  });

  it("accepts a bundle wrapped in ```json fences inside the envelope", () => {
    const raw = envelope("```json\n" + JSON.stringify(validBundle, null, 2) + "\n```");
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
    expect(r.bundle.rule).toBe("llm-test");
  });

  it("accepts a bundle wrapped in bare ``` fences", () => {
    const raw = envelope("```\n" + JSON.stringify(validBundle) + "\n```");
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
  });

  it("accepts a bundle with leading prose (brace-extract fallback)", () => {
    const raw = envelope("Here's the bundle you asked for:\n\n" + JSON.stringify(validBundle));
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
  });

  it("accepts raw JSON without the CLI envelope", () => {
    const raw = JSON.stringify(validBundle);
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(true);
  });

  it("accepts an N-target bundle", () => {
    const b = {
      rule: "multi",
      summary: "three-lever tweak",
      targets: [
        { target: "GAME.critRate", before: 0.12, after: 0.14 },
        { target: "GAME.mpRegen", before: 4, after: 3 },
        { target: "engineer.REJECT SUBMITTAL.dmg", before: [16, 24], after: [15, 23] },
      ],
    };
    const r = parseBundle(envelope(JSON.stringify(b)), state);
    expect(r.ok).toBe(true);
    expect(r.bundle.targets).toHaveLength(3);
  });
});

describe("parseBundle — parse failures", () => {
  it("rejects non-JSON garbage", () => {
    const r = parseBundle("not json at all — no braces either", state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not parse/i);
  });

  it("rejects envelope with non-string result", () => {
    const raw = JSON.stringify({ type: "result", result: 42 });
    const r = parseBundle(raw, state);
    expect(r.ok).toBe(false);
  });
});

describe("parseBundle — schema violations", () => {
  const ok = (bundle) => envelope(JSON.stringify(bundle));

  it("rejects missing rule", () => {
    const r = parseBundle(ok({ summary: "s", targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rule/);
  });

  it("rejects missing summary", () => {
    const r = parseBundle(ok({ rule: "r", targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/summary/);
  });

  it("rejects empty targets array", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: [] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/targets/);
  });

  it("rejects target with bad grammar", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: [{ target: "game.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/grammar/);
  });

  it("rejects target referencing unknown GAME key", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: [{ target: "GAME.nonexistent", before: 0, after: 0 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown/i);
  });

  it("rejects target referencing unknown move", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.NONEXISTENT.dmg", before: [0, 0], after: [1, 1] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no move/i);
  });

  it("rejects before mismatch (LLM hallucinated baseline)", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.critRate", before: 0.99, after: 0.97 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/before was/);
  });

  it("rejects step-size violation on rate", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.critRate", before: 0.12, after: 0.20 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/step > 0\.02/);
  });

  it("rejects step-size violation on multiplier", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.critMultiplier", before: 1.6, after: 1.8 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/step > 0\.05/);
  });

  it("rejects step-size violation on dmg", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.REJECT SUBMITTAL.dmg", before: [16, 24], after: [20, 30] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/step must be/);
  });

  it("accepts ±1 int dmg shift", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.REJECT SUBMITTAL.dmg", before: [16, 24], after: [17, 25] }] }), state);
    expect(r.ok).toBe(true);
  });

  it("rejects healRange out-of-bounds step", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.healRange", before: [28, 45], after: [35, 50] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/healRange/);
  });

  it("rejects targets that aren't an array", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s", targets: "not array" }), state);
    expect(r.ok).toBe(false);
  });

  it("rejects summary > 200 chars", () => {
    const r = parseBundle(ok({ rule: "r", summary: "x".repeat(201),
      targets: [{ target: "GAME.critRate", before: 0.12, after: 0.14 }] }), state);
    expect(r.ok).toBe(false);
  });

  it("handles move name with dots if any (first-dot / last-dot split)", () => {
    // Edge case: move name cannot contain dots per grammar, but if a bad target slipped
    // through the regex due to loose "+" matching, resolveCurrent would fail.
    // The grammar regex `/^(?:engineer|contractor)\..+\.(?:dmg|mp)$/` is greedy on `.+`,
    // so "engineer.a.b.dmg" parses as side=engineer, field=dmg, name="a.b".
    // That's a real move-name-with-dots corner case the content doesn't use, but the
    // parser handles it deterministically — verify:
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "engineer.a.b.dmg", before: [1, 2], after: [2, 3] }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no move/);
  });

  it("accepts ±0.02 step on GAME.aiCounterBias (rate bounds)", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.aiCounterBias", before: 0.7, after: 0.68 }] }), state);
    expect(r.ok).toBe(true);
  });

  it("rejects step > 0.02 on GAME.aiCounterBias", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.aiCounterBias", before: 0.7, after: 0.75 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/aiCounterBias step > 0\.02/);
  });

  it("accepts ±0.05 step on GAME.counterMultiplier (multiplier bounds)", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.counterMultiplier", before: 1.3, after: 1.25 }] }), state);
    expect(r.ok).toBe(true);
  });

  it("rejects step > 0.05 on GAME.counterMultiplier", () => {
    const r = parseBundle(ok({ rule: "r", summary: "s",
      targets: [{ target: "GAME.counterMultiplier", before: 1.3, after: 1.5 }] }), state);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/counterMultiplier step > 0\.05/);
  });
});
