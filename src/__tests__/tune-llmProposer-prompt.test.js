import { describe, it, expect } from "vitest";
import { buildPrompt } from "../tune/llmProposer.js";

const baseState = {
  GAME: { critRate: 0.12, critMultiplier: 1.6, mpRegen: 4, healRange: [28, 45] },
  moves: {
    engineer: [{ name: "REJECT SUBMITTAL", dmg: [16, 24], mp: 10 }],
    contractor: [{ name: "CLAIM DSC", dmg: [18, 28], mp: 12 }],
  },
};
const baseReport = {
  matchups: [
    { matchup: "random-vs-random", engineerWinRate: 0.865, avgTurns: 12.5,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.4 }, contractor: { "CLAIM DSC": 0.35 } } },
    { matchup: "random-vs-ai", engineerWinRate: 0.715, avgTurns: 18.7,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.3 }, contractor: { "CLAIM DSC": 0.5 } } },
  ],
};

describe("buildPrompt", () => {
  it("starts with the static prefix for prompt-cache locality", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out.startsWith("# Role\n")).toBe(true);
    expect(out).toContain("# Target grammar (STRICT)");
    expect(out).toContain("# Step-size bounds (REJECTED if exceeded)");
    expect(out).toContain("# Response format (STRICT)");
  });

  it("embeds current content as JSON code fences", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out).toContain("## content/game.json");
    expect(out).toContain("## content/moves/engineer.json");
    expect(out).toContain("## content/moves/contractor.json");
    // JSON should be verbatim-embedded
    expect(out).toContain('"critRate": 0.12');
    expect(out).toContain('"REJECT SUBMITTAL"');
  });

  it("summarizes the current balance report per matchup", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out).toContain("## random-vs-random");
    expect(out).toContain("engineerWinRate: 86.50%");
    expect(out).toContain("## random-vs-ai");
    expect(out).toContain("engineerWinRate: 71.50%");
  });

  it("emits '(no prior iterations)' when history is empty or only baseline", () => {
    const out1 = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out1).toContain("(no prior iterations)");
    const out2 = buildPrompt({ currentState: baseState, currentReport: baseReport,
      history: [{ iteration: 0, bundle: null, outcome: "baseline", report: baseReport }] });
    expect(out2).toContain("(no prior iterations)");
  });

  it("embeds last 3 non-baseline history entries in oldest-first order", () => {
    const mkEntry = (i, outcome, extra = {}) => ({
      iteration: i, bundle: { rule: `r${i}`, summary: `s${i}`, targets: [] },
      outcome, report: baseReport, ...extra,
    });
    const history = [
      { iteration: 0, bundle: null, outcome: "baseline", report: baseReport },
      mkEntry(1, "tests-failed", { worstDistanceBefore: 0.365 }),
      mkEntry(2, "accepted", { worstDistanceBefore: 0.365, worstDistanceAfter: 0.320 }),
      mkEntry(3, "not-improvement", { worstDistanceBefore: 0.320 }),
      mkEntry(4, "accepted", { worstDistanceBefore: 0.320, worstDistanceAfter: 0.280 }),
    ];
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history });
    // Last 3 after filtering baseline: entries 2, 3, 4
    expect(out).toContain('"iteration": 2');
    expect(out).toContain('"iteration": 3');
    expect(out).toContain('"iteration": 4');
    expect(out).not.toContain('"iteration": 1');
    expect(out).not.toContain('"iteration": 0');
    // Delta signal present on accepted entries
    expect(out).toContain('"worstDistanceAfter": 0.28');
    // No worstDistanceAfter on non-improvement
    const idx = out.indexOf('"iteration": 3');
    const until = out.indexOf('"iteration": 4');
    expect(out.slice(idx, until)).not.toContain('"worstDistanceAfter"');
  });

  it("includes retry context when retryError is provided", () => {
    const out = buildPrompt({
      currentState: baseState, currentReport: baseReport, history: [],
      retryError: "targets[0].before mismatch",
    });
    expect(out).toContain("# Retry context");
    expect(out).toContain("targets[0].before mismatch");
  });

  it("ends with the task instruction", () => {
    const out = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(out).toContain("# Task");
    expect(out).toMatch(/Respond with ONLY the JSON bundle\.\s*$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    const b = buildPrompt({ currentState: baseState, currentReport: baseReport, history: [] });
    expect(a).toBe(b);
  });
});
