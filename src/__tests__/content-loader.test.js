import { describe, it, expect } from "vitest";
import { ENGINEER, CONTRACTOR, pickIntroSequence, GAME_OVER_TEXT } from "../data/content-loader.js";
import { GAME } from "../constants.js";

describe("Content Loader", () => {
  describe("ENGINEER", () => {
    it("has correct stats", () => {
      expect(ENGINEER.name).toBe("ENGINEER");
      expect(ENGINEER.maxHp).toBe(140);
      expect(ENGINEER.maxMp).toBe(70);
      expect(ENGINEER.mpRegen).toBe(GAME.mpRegen);
    });

    it("has 6 moves", () => {
      expect(ENGINEER.moves).toHaveLength(6);
    });

    it("each move has merged quotes", () => {
      ENGINEER.moves.forEach((move) => {
        expect(move.quotes).toBeDefined();
        expect(move.quotes.default.length).toBeGreaterThan(0);
      });
    });

    it("each move has all required fields after merge", () => {
      ENGINEER.moves.forEach((move) => {
        expect(move).toHaveProperty("name");
        expect(move).toHaveProperty("emoji");
        expect(move).toHaveProperty("desc");
        expect(move).toHaveProperty("dmg");
        expect(move).toHaveProperty("mp");
        expect(move).toHaveProperty("effect");
        expect(move).toHaveProperty("quotes");
      });
    });
  });

  describe("CONTRACTOR", () => {
    it("has correct stats", () => {
      expect(CONTRACTOR.name).toBe("CONTRACTOR");
      expect(CONTRACTOR.maxHp).toBe(150);
      expect(CONTRACTOR.maxMp).toBe(60);
      expect(CONTRACTOR.mpRegen).toBe(GAME.mpRegen);
    });

    it("has 6 moves", () => {
      expect(CONTRACTOR.moves).toHaveLength(6);
    });

    it("each move has merged quotes", () => {
      CONTRACTOR.moves.forEach((move) => {
        expect(move.quotes).toBeDefined();
        expect(move.quotes.default.length).toBeGreaterThan(0);
      });
    });
  });

  describe("pickIntroSequence", () => {
    it("returns an array of steps", () => {
      const seq = pickIntroSequence();
      expect(Array.isArray(seq)).toBe(true);
      expect(seq.length).toBeGreaterThan(0);
    });

    it("each step has entry with text and resolved hex color", () => {
      const seq = pickIntroSequence();
      seq.forEach((step) => {
        expect(step).toHaveProperty("entry");
        expect(step).toHaveProperty("delay");
        expect(step.entry).toHaveProperty("text");
        expect(step.entry).toHaveProperty("color");
        expect(step.entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });
  });

  describe("GAME_OVER_TEXT", () => {
    it("has engineer and contractor arrays", () => {
      expect(Array.isArray(GAME_OVER_TEXT.engineer)).toBe(true);
      expect(Array.isArray(GAME_OVER_TEXT.contractor)).toBe(true);
      expect(GAME_OVER_TEXT.engineer.length).toBeGreaterThan(0);
      expect(GAME_OVER_TEXT.contractor.length).toBeGreaterThan(0);
    });
  });
});

describe("quote shape normalization", () => {
  it("every engineer move has quotes as an object with `default` array", () => {
    ENGINEER.moves.forEach((m) => {
      expect(m.quotes).toBeTypeOf("object");
      expect(Array.isArray(m.quotes.default)).toBe(true);
      expect(m.quotes.default.length).toBeGreaterThan(0);
    });
  });

  it("every contractor move has quotes as an object with `default` array", () => {
    CONTRACTOR.moves.forEach((m) => {
      expect(m.quotes).toBeTypeOf("object");
      expect(Array.isArray(m.quotes.default)).toBe(true);
      expect(m.quotes.default.length).toBeGreaterThan(0);
    });
  });
});
