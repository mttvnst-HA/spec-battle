import { describe, it, expect } from "vitest";
import engineerMoves from "../../content/moves/engineer.json";
import contractorMoves from "../../content/moves/contractor.json";
import engineerQuotes from "../../content/quotes/engineer.json";
import contractorQuotes from "../../content/quotes/contractor.json";
import introsData from "../../content/intros.json";
import gameOverData from "../../content/game-over.json";

const VALID_EFFECTS = [null, "stun", "weaken", "slow", "defense", "heal"];
const VALID_COLORS = ["yellow", "white", "orange", "red", "cyan", "bright", "muted", "hpGreen"];

function validateMoves(moves, quotes, label) {
  describe(`${label} moves`, () => {
    it("has at least 1 move", () => {
      expect(moves.length).toBeGreaterThan(0);
    });

    moves.forEach((move) => {
      describe(`${move.name}`, () => {
        it("has required fields", () => {
          expect(move).toHaveProperty("name");
          expect(move).toHaveProperty("emoji");
          expect(move).toHaveProperty("desc");
          expect(move).toHaveProperty("dmg");
          expect(move).toHaveProperty("mp");
          expect(move).toHaveProperty("effect");
        });

        it("has valid dmg range [min, max]", () => {
          expect(move.dmg).toHaveLength(2);
          expect(move.dmg[0]).toBeTypeOf("number");
          expect(move.dmg[1]).toBeTypeOf("number");
          expect(move.dmg[0]).toBeLessThanOrEqual(move.dmg[1]);
        });

        it("has non-negative MP cost", () => {
          expect(move.mp).toBeGreaterThanOrEqual(0);
        });

        it("has valid effect type", () => {
          expect(VALID_EFFECTS).toContain(move.effect);
        });

        it("has matching quotes with at least 3 entries", () => {
          const moveQuotes = quotes[move.name];
          expect(moveQuotes).toBeDefined();
          expect(moveQuotes.length).toBeGreaterThanOrEqual(3);
        });

        it("has no duplicate quotes", () => {
          const moveQuotes = quotes[move.name];
          if (moveQuotes) {
            const unique = new Set(moveQuotes);
            expect(unique.size).toBe(moveQuotes.length);
          }
        });

        it("all quotes are non-empty strings", () => {
          const moveQuotes = quotes[move.name] || [];
          moveQuotes.forEach((q) => {
            expect(q).toBeTypeOf("string");
            expect(q.trim().length).toBeGreaterThan(0);
          });
        });
      });
    });
  });
}

describe("Content Integrity", () => {
  validateMoves(engineerMoves, engineerQuotes, "Engineer");
  validateMoves(contractorMoves, contractorQuotes, "Contractor");

  describe("Intro sequences", () => {
    it("has at least 1 intro", () => {
      expect(introsData.length).toBeGreaterThan(0);
    });

    introsData.forEach((intro, i) => {
      describe(`Intro ${i}: ${intro.name}`, () => {
        it("has a name", () => {
          expect(intro.name).toBeTypeOf("string");
          expect(intro.name.length).toBeGreaterThan(0);
        });

        it("has at least 2 steps", () => {
          expect(intro.steps.length).toBeGreaterThanOrEqual(2);
        });

        it("first step has delay 0", () => {
          expect(intro.steps[0].delay).toBe(0);
        });

        intro.steps.forEach((step, j) => {
          it(`step ${j} has required fields`, () => {
            expect(step).toHaveProperty("text");
            expect(step).toHaveProperty("color");
            expect(step).toHaveProperty("delay");
            expect(step.text).toBeTypeOf("string");
            expect(step.delay).toBeTypeOf("number");
            expect(step.delay).toBeGreaterThanOrEqual(0);
          });

          it(`step ${j} has valid color`, () => {
            expect(VALID_COLORS).toContain(step.color);
          });
        });
      });
    });
  });

  describe("Game over text", () => {
    it("has engineer victory text", () => {
      expect(gameOverData.engineer).toBeDefined();
      expect(gameOverData.engineer.length).toBeGreaterThan(0);
    });

    it("has contractor victory text", () => {
      expect(gameOverData.contractor).toBeDefined();
      expect(gameOverData.contractor.length).toBeGreaterThan(0);
    });

    it("all entries are non-empty strings", () => {
      [...gameOverData.engineer, ...gameOverData.contractor].forEach((text) => {
        expect(text).toBeTypeOf("string");
        expect(text.trim().length).toBeGreaterThan(0);
      });
    });
  });
});
