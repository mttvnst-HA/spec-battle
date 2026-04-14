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

  it("iteration 0 picks rule 'nerf-top-usage-move' (engineer dominant → REJECT SUBMITTAL is top)", () => {
    const p = propose(dominantEngineerReport, 0);
    expect(p.rule).toBe("nerf-top-usage-move");
    // REJECT SUBMITTAL is the top-used engineer move (32% / 40%).
    expect(p.target).toBe("engineer.REJECT SUBMITTAL.dmg");
    expect(p.before).toEqual([16, 24]);
    expect(p.after).toEqual([15, 23]);
  });

  it("iteration 2 falls through lower-crit-multiplier (mean turns > 14), lands on trim-mp-regen", () => {
    // Rule 2 (lower-crit-multiplier) fires only when mean avgTurns < 14.
    // Fixture: (12.46 + 18.7) / 2 = 15.58 → rule 2 declines.
    // Round-robin advances to rule 3 (trim-mp-regen). Conditions:
    //   engineer winrate avg = (0.865 + 0.72) / 2 = 0.79 ≥ 0.6 ✓
    //   engineer top-2 MP moves: CURE NOTICE (28) + INVOKE SHALL (20), avg 24 > 10 ✓
    // So rule 3 fires.
    const p = propose(dominantEngineerReport, 2);
    expect(p.rule).toBe("trim-mp-regen");
    expect(p.target).toBe("GAME.mpRegen");
    expect(p.before).toBe(4);
    expect(p.after).toBe(3);
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
    // Iteration 6 should try the same rule as iteration 0.
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
    // Build a contractor-dominant report: engineer wins only 20% in both.
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
    // Force round-robin onto the raise-heal-floor rule (index 5) by picking
    // iteration 5. Contractor is dominant → raise-heal-floor declines → round-robin
    // should continue to try other rules. The exact rule that fires isn't the
    // point; the point is that raise-heal-floor alone does NOT fire for this input.
    // Assert by calling the rule directly.
    const ruleRaiseHeal = RULES.find((r) => r.name === "raise-heal-floor");
    expect(ruleRaiseHeal).toBeTruthy();
    const cfg = {
      GAME: { healRange: [28, 45] },
      moves: { engineer: [], contractor: [] },
    };
    expect(ruleRaiseHeal.fn(contractorDominant, cfg)).toBeNull();
  });
});
