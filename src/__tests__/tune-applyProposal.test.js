import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, writeBundle, revertBundle } from "../tune/applyProposal.js";

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

describe("writeBundle / revertBundle — GAME scalar", () => {
  it("writes a GAME scalar change, then reverts it exactly", () => {
    const before = readConfig().GAME.critMultiplier;
    const bundle = {
      rule: "test",
      summary: "test",
      targets: [{
        target: "GAME.critMultiplier",
        before,
        after: before - 0.05,
      }],
    };
    writeBundle(bundle);
    expect(readConfig().GAME.critMultiplier).toBeCloseTo(before - 0.05);

    revertBundle(bundle);
    expect(readConfig().GAME.critMultiplier).toBeCloseTo(before);
  });
});

describe("writeBundle / revertBundle — GAME tuple", () => {
  it("writes an array-valued GAME field, then reverts", () => {
    const before = readConfig().GAME.healRange;
    const after = [before[0] + 2, before[1]];
    const bundle = {
      rule: "test",
      summary: "test",
      targets: [{
        target: "GAME.healRange",
        before,
        after,
      }],
    };
    writeBundle(bundle);
    expect(readConfig().GAME.healRange).toEqual(after);

    revertBundle(bundle);
    expect(readConfig().GAME.healRange).toEqual(before);
  });
});

describe("writeBundle / revertBundle — move field", () => {
  it("writes a move dmg change, then reverts", () => {
    const cfg = readConfig();
    const original = cfg.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    const before = original.dmg;
    const after = [before[0] - 1, before[1] - 1];
    const bundle = {
      rule: "test",
      summary: "test",
      targets: [{
        target: "engineer.REJECT SUBMITTAL.dmg",
        before,
        after,
      }],
    };
    writeBundle(bundle);
    const afterCfg = readConfig();
    const mutated = afterCfg.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(mutated.dmg).toEqual(after);

    revertBundle(bundle);
    const restored = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(restored.dmg).toEqual(before);
  });

  it("writes a move mp change (scalar), then reverts", () => {
    const bundle = {
      rule: "test",
      summary: "test",
      targets: [{
        target: "engineer.REJECT SUBMITTAL.mp",
        before: 0,
        after: 1,
      }],
    };
    writeBundle(bundle);
    const mutated = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(mutated.mp).toBe(1);

    revertBundle(bundle);
    const restored = readConfig().moves.engineer.find((m) => m.name === "REJECT SUBMITTAL");
    expect(restored.mp).toBe(0);
  });
});

describe("writeBundle — error paths", () => {
  it("throws on an unknown GAME key", () => {
    const bundle = {
      rule: "test",
      summary: "test",
      targets: [{
        target: "GAME.bogusKey",
        before: 1,
        after: 2,
      }],
    };
    expect(() => writeBundle(bundle)).toThrow(/GAME\.bogusKey/);
  });

  it("throws on an unknown move name", () => {
    const bundle = {
      rule: "test",
      summary: "test",
      targets: [{
        target: "engineer.NOPE.dmg",
        before: [1, 2],
        after: [2, 3],
      }],
    };
    expect(() => writeBundle(bundle)).toThrow(/NOPE/);
  });

  it("writeBundle + revertBundle round-trips a 3-target bundle", () => {
    const before = readConfig();
    const bundle = {
      rule: "llm-multi",
      summary: "3-target test bundle",
      targets: [
        { target: "GAME.critRate", before: before.GAME.critRate, after: +(before.GAME.critRate + 0.02).toFixed(2) },
        { target: "GAME.mpRegen", before: before.GAME.mpRegen, after: before.GAME.mpRegen + 1 },
        { target: "engineer.REJECT SUBMITTAL.dmg",
          before: before.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL").dmg,
          after: before.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL").dmg.map((v) => v + 1) },
      ],
    };
    writeBundle(bundle);
    const mid = readConfig();
    expect(mid.GAME.critRate).toBeCloseTo(bundle.targets[0].after, 6);
    expect(mid.GAME.mpRegen).toBe(bundle.targets[1].after);
    expect(mid.moves.engineer.find((m) => m.name === "REJECT SUBMITTAL").dmg).toEqual(bundle.targets[2].after);
    revertBundle(bundle);
    const after = readConfig();
    expect(after).toEqual(before);
  });

  it("writeBundle reverts prior targets and throws if a later target fails", () => {
    const before = readConfig();
    const bundle = {
      rule: "llm-bad",
      summary: "first target ok, second target bad",
      targets: [
        { target: "GAME.critRate", before: before.GAME.critRate, after: +(before.GAME.critRate + 0.02).toFixed(2) },
        { target: "engineer.THIS MOVE DOES NOT EXIST.dmg", before: [10, 20], after: [11, 21] },
      ],
    };
    expect(() => writeBundle(bundle)).toThrow(/no move named/);
    const after = readConfig();
    // First target must have been reverted — we should be bit-identical to before.
    expect(after).toEqual(before);
  });
});
