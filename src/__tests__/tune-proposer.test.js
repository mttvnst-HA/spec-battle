import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { propose, RULES } from "../tune/proposer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const gameJsonPath = path.join(repoRoot, "content/game.json");
const engMovesPath = path.join(repoRoot, "content/moves/engineer.json");
const conMovesPath = path.join(repoRoot, "content/moves/contractor.json");

let origGame, origEng, origCon;

beforeEach(() => {
  origGame = fs.readFileSync(gameJsonPath, "utf-8");
  origEng = fs.readFileSync(engMovesPath, "utf-8");
  origCon = fs.readFileSync(conMovesPath, "utf-8");
});

afterEach(() => {
  fs.writeFileSync(gameJsonPath, origGame);
  fs.writeFileSync(engMovesPath, origEng);
  fs.writeFileSync(conMovesPath, origCon);
});

// Helper that mimics the balance-baseline.json shape.
const dominantEngineerReport = {
  matchups: [
    {
      matchup: "random-vs-random",
      engineerWinRate: 0.865,
      contractorWinRate: 0.135,
      drawRate: 0,
      avgTurns: 12.46,
      moveFrequency: {
        engineer: {
          "REJECT SUBMITTAL": 0.32, "CITE UFC": 0.15, "INVOKE SHALL": 0.13,
          "RED-LINE SPEC": 0.15, "CURE NOTICE": 0.12, "ISSUE NCR": 0.13,
        },
        contractor: {
          "SCHEDULE DELAY": 0.16, "SUBMIT RFI": 0.20, "RESERVE RIGHTS": 0.18,
          "CLAIM DSC": 0.15, "VALUE ENGINEER": 0.15, "OR-EQUAL GAMBIT": 0.16,
        },
      },
    },
    {
      matchup: "random-vs-ai",
      engineerWinRate: 0.72,
      contractorWinRate: 0.28,
      drawRate: 0,
      avgTurns: 18.7,
      moveFrequency: {
        engineer: {
          "REJECT SUBMITTAL": 0.40, "CITE UFC": 0.15, "INVOKE SHALL": 0.10,
          "RED-LINE SPEC": 0.12, "CURE NOTICE": 0.09, "ISSUE NCR": 0.14,
        },
        contractor: {
          "SUBMIT RFI": 0.21, "RESERVE RIGHTS": 0.26, "VALUE ENGINEER": 0.27,
          "OR-EQUAL GAMBIT": 0.09, "CLAIM DSC": 0.08, "SCHEDULE DELAY": 0.10,
        },
      },
    },
  ],
};

describe("RULES library", () => {
  it("exposes 6 named rules in priority order", () => {
    expect(RULES).toHaveLength(6);
    expect(RULES.map((r) => r.name)).toEqual([
      "nerf-top-usage-move",
      "buff-weak-side-top-move",
      "lower-crit-multiplier",
      "trim-mp-regen",
      "tame-weaken",
      "raise-heal-floor",
    ]);
  });
});

describe("propose (round-robin)", () => {
  it("returns a Proposal object for iteration 0 with dominant-engineer baseline", () => {
    const p = propose(dominantEngineerReport, 0);
    expect(p).not.toBeNull();
    expect(p).toEqual(expect.objectContaining({
      rule: expect.any(String),
      target: expect.any(String),
      before: expect.anything(),
      after: expect.anything(),
      summary: expect.any(String),
    }));
  });

  it("iteration 0 picks rule 'nerf-top-usage-move' and targets a tuner-legal field", () => {
    const p = propose(dominantEngineerReport, 0);
    expect(p.rule).toBe("nerf-top-usage-move");
    // Target grammar: GAME.<key> OR <side>.<moveName>.<dmg|mp>.
    expect(p.target).toMatch(/^(GAME\.[a-zA-Z]+|(?:engineer|contractor)\.[^.]+\.(?:dmg|mp))$/);
    // Rule 1 targets the dominant side's top-usage move and decrements dmg or increments mp by 1.
    // We don't pin which specific move — that's content-dependent — only the invariant.
    if (p.target.endsWith(".dmg")) {
      // dmg mutation: both bounds drop by 1.
      expect(Array.isArray(p.before)).toBe(true);
      expect(Array.isArray(p.after)).toBe(true);
      expect(p.after[0]).toBe(p.before[0] - 1);
      expect(p.after[1]).toBe(p.before[1] - 1);
    } else if (p.target.endsWith(".mp")) {
      // mp fallback: raises cost by 1.
      expect(p.after).toBe(p.before + 1);
    }
  });

  it("iteration 2 falls through to trim-mp-regen given baseline-like avgTurns and mp costs", () => {
    // Rule index 2 (lower-crit-multiplier) declines when mean avgTurns >= 14.
    // Fixture mean: (12.46 + 18.7) / 2 = 15.58 → declines.
    // Rule 3 (trim-mp-regen) accepts when engineer is dominant and top-2 MP avg > 10.
    const p = propose(dominantEngineerReport, 2);
    expect(p.rule).toBe("trim-mp-regen");
    expect(p.target).toBe("GAME.mpRegen");
    // Invariant: step size -1 (GAME.mpRegen decrements by 1).
    expect(typeof p.before).toBe("number");
    expect(typeof p.after).toBe("number");
    expect(p.after).toBe(p.before - 1);
  });

  it("returns null if all rules decline (balanced report)", () => {
    const balanced = {
      matchups: [
        {
          matchup: "random-vs-random",
          engineerWinRate: 0.5, contractorWinRate: 0.5, drawRate: 0, avgTurns: 20,
          moveFrequency: { engineer: {}, contractor: {} },
        },
        {
          matchup: "random-vs-ai",
          engineerWinRate: 0.5, contractorWinRate: 0.5, drawRate: 0, avgTurns: 20,
          moveFrequency: { engineer: {}, contractor: {} },
        },
      ],
    };
    expect(propose(balanced, 0)).toBeNull();
    expect(propose(balanced, 5)).toBeNull();
  });

  it("round-robin starts from iteration index modulo RULES.length", () => {
    const p0 = propose(dominantEngineerReport, 0);
    const p6 = propose(dominantEngineerReport, 6);
    expect(p6.rule).toBe(p0.rule);
  });

  it("is deterministic given the same report and iteration", () => {
    const a = propose(dominantEngineerReport, 0);
    const b = propose(dominantEngineerReport, 0);
    expect(a).toEqual(b);
  });

  it("raise-heal-floor rule declines when contractor is dominant", () => {
    const contractorDominant = {
      matchups: [
        {
          matchup: "random-vs-random",
          engineerWinRate: 0.2, contractorWinRate: 0.8, drawRate: 0, avgTurns: 20,
          moveFrequency: { engineer: {}, contractor: {} },
        },
        {
          matchup: "random-vs-ai",
          engineerWinRate: 0.2, contractorWinRate: 0.8, drawRate: 0, avgTurns: 20,
          moveFrequency: { engineer: {}, contractor: {} },
        },
      ],
    };
    const ruleRaiseHeal = RULES.find((r) => r.name === "raise-heal-floor");
    expect(ruleRaiseHeal).toBeTruthy();
    const cfg = {
      GAME: { healRange: [28, 45] },
      moves: { engineer: [], contractor: [] },
    };
    expect(ruleRaiseHeal.fn(contractorDominant, cfg)).toBeNull();
  });
});
