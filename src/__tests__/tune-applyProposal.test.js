import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, writeProposal, revertProposal } from "../tune/applyProposal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const gameJsonPath = path.join(repoRoot, "content/game.json");
const engMovesPath = path.join(repoRoot, "content/moves/engineer.json");

let originalGame;
let originalEngMoves;

beforeEach(() => {
  originalGame = fs.readFileSync(gameJsonPath, "utf-8");
  originalEngMoves = fs.readFileSync(engMovesPath, "utf-8");
});

afterEach(() => {
  fs.writeFileSync(gameJsonPath, originalGame);
  fs.writeFileSync(engMovesPath, originalEngMoves);
});

describe("readConfig", () => {
  it("returns the current GAME and moves for both sides", () => {
    const cfg = readConfig();
    expect(cfg.GAME).toEqual(expect.objectContaining({
      critRate: expect.any(Number),
      critMultiplier: expect.any(Number),
      mpRegen: expect.any(Number),
    }));
    expect(cfg.moves.engineer).toBeInstanceOf(Array);
    expect(cfg.moves.engineer[0]).toHaveProperty("name");
    expect(cfg.moves.contractor).toBeInstanceOf(Array);
  });
});

describe("writeProposal / revertProposal — GAME scalar", () => {
  it("writes a GAME scalar change, then reverts it exactly", () => {
    const before = readConfig().GAME.critMultiplier;
    const proposal = {
      rule: "test",
      target: "GAME.critMultiplier",
      before,
      after: before - 0.05,
      summary: "test",
    };
    writeProposal(proposal);
    expect(readConfig().GAME.critMultiplier).toBeCloseTo(before - 0.05);

    revertProposal(proposal);
    expect(readConfig().GAME.critMultiplier).toBeCloseTo(before);
  });
});

describe("writeProposal / revertProposal — GAME tuple", () => {
  it("writes an array-valued GAME field, then reverts", () => {
    const before = readConfig().GAME.healRange;
    const after = [before[0] + 2, before[1]];
    const proposal = {
      rule: "test",
      target: "GAME.healRange",
      before,
      after,
      summary: "test",
    };
    writeProposal(proposal);
    expect(readConfig().GAME.healRange).toEqual(after);

    revertProposal(proposal);
    expect(readConfig().GAME.healRange).toEqual(before);
  });
});

describe("writeProposal / revertProposal — move field", () => {
  it("writes a move dmg change, then reverts", () => {
    const cfg = readConfig();
    const original = cfg.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    const before = original.dmg;
    const after = [before[0] - 1, before[1] - 1];
    const proposal = {
      rule: "test",
      target: "engineer.REJECT SUBMITTAL.dmg",
      before,
      after,
      summary: "test",
    };
    writeProposal(proposal);
    const afterCfg = readConfig();
    const mutated = afterCfg.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(mutated.dmg).toEqual(after);

    revertProposal(proposal);
    const restored = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(restored.dmg).toEqual(before);
  });

  it("writes a move mp change (scalar), then reverts", () => {
    const proposal = {
      rule: "test",
      target: "engineer.REJECT SUBMITTAL.mp",
      before: 0,
      after: 1,
      summary: "test",
    };
    writeProposal(proposal);
    const mutated = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(mutated.mp).toBe(1);

    revertProposal(proposal);
    const restored = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(restored.mp).toBe(0);
  });
});

describe("writeProposal — error paths", () => {
  it("throws on an unknown GAME key", () => {
    const proposal = {
      rule: "test", target: "GAME.bogusKey", before: 1, after: 2, summary: "test",
    };
    expect(() => writeProposal(proposal)).toThrow(/GAME\.bogusKey/);
  });

  it("throws on an unknown move name", () => {
    const proposal = {
      rule: "test", target: "engineer.NOPE.dmg", before: [1, 2], after: [2, 3], summary: "test",
    };
    expect(() => writeProposal(proposal)).toThrow(/NOPE/);
  });
});
