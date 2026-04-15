// Phase 2.2e — tests for the fresh-process sim driver at scripts/tune-sim.js.
//
// Two concerns:
//  1. CLI contract — argv validation, JSON config validation, stdout shape.
//  2. Cache-bug regression canary — mutating content/moves/*.json on disk must
//     change the sim output between two back-to-back driver invocations. If
//     this test ever fails, it means we've regressed to reading content from
//     an ESM-cached import somewhere in the sim path, which is exactly the
//     bug Phase 2.2e fixed. See ROADMAP.md Phase 2.2e for background.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const driverPath = path.join(repoRoot, "scripts/tune-sim.js");
const engMovesPath = path.join(repoRoot, "content/moves/engineer.json");

// Tiny config for speed: 25 games × 1 chunk × 2 matchups ≈ 100ms/sim on top of
// Node startup (~300ms). Total per invocation < 500ms.
const tinyConfig = JSON.stringify({ startSeed: 1, count: 25, seedChunks: 1 });

function runDriver(configJson) {
  return execFileSync("node", [driverPath, configJson], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

describe("tune-sim driver — CLI contract", () => {
  it("emits { matchups: [BalanceReport, BalanceReport] } on valid config", () => {
    const stdout = runDriver(tinyConfig);
    const parsed = JSON.parse(stdout);

    expect(parsed.matchups).toHaveLength(2);
    for (const report of parsed.matchups) {
      expect(report).toEqual(
        expect.objectContaining({
          matchup: expect.any(String),
          startSeed: 1,
          count: 25,
          engineerWinRate: expect.any(Number),
          contractorWinRate: expect.any(Number),
          drawRate: expect.any(Number),
          avgTurns: expect.any(Number),
          moveFrequency: expect.objectContaining({
            engineer: expect.any(Object),
            contractor: expect.any(Object),
          }),
        }),
      );
    }
    expect(parsed.matchups[0].matchup).toBe("random-vs-random");
    expect(parsed.matchups[1].matchup).toBe("random-vs-ai");
  });

  it("is deterministic — same config → byte-identical stdout", () => {
    const a = runDriver(tinyConfig);
    const b = runDriver(tinyConfig);
    expect(a).toBe(b);
  });

  it("exits non-zero when argv is missing", () => {
    expect(() =>
      execFileSync("node", [driverPath], { encoding: "utf-8", stdio: "pipe" }),
    ).toThrow();
  });

  it("exits non-zero on invalid JSON config", () => {
    expect(() =>
      execFileSync("node", [driverPath, "{not json"], {
        encoding: "utf-8",
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("exits non-zero on non-integer startSeed / count / seedChunks", () => {
    const bad = JSON.stringify({ startSeed: 1.5, count: 25, seedChunks: 1 });
    expect(() =>
      execFileSync("node", [driverPath, bad], {
        encoding: "utf-8",
        stdio: "pipe",
      }),
    ).toThrow();
  });
});

describe("tune-sim driver — cache-bug regression canary", () => {
  let originalEngMoves;

  beforeEach(() => {
    originalEngMoves = fs.readFileSync(engMovesPath, "utf-8");
  });

  afterEach(() => {
    fs.writeFileSync(engMovesPath, originalEngMoves);
  });

  it("picks up mid-run disk mutations to content/moves/*.json", () => {
    // Baseline sim with the committed content.
    const before = JSON.parse(runDriver(tinyConfig));
    const rvrBefore = before.matchups[0].engineerWinRate;

    // Mutate REJECT SUBMITTAL to deal 300 damage per hit. At this scale the
    // engineer will steamroll a random-vs-random matchup, moving engineerWinRate
    // well past any plausible same-seed sampling variation.
    const moves = JSON.parse(originalEngMoves);
    const reject = moves.find((m) => m.name === "REJECT SUBMITTAL");
    expect(reject).toBeTruthy();
    reject.dmg = [300, 300];
    fs.writeFileSync(engMovesPath, JSON.stringify(moves, null, 2));

    // Second sim — must see the disk change. Same seed, same count, same
    // everything except the on-disk move stats.
    const after = JSON.parse(runDriver(tinyConfig));
    const rvrAfter = after.matchups[0].engineerWinRate;

    // If the driver were running in a process that cached the ESM JSON import,
    // `after` would equal `before` byte-for-byte. Assert a real shift. A 300
    // damage nuke versus a 15-23 baseline is several orders of magnitude over
    // noise — demand at least a 10pp swing toward 1.0.
    expect(rvrAfter).toBeGreaterThan(rvrBefore + 0.1);
  });
});
