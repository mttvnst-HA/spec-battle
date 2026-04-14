import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBatch } from "../sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";

const WIN_RATE_TOLERANCE = 0.005;  // ±0.5pp — seeded xorshift32 should produce zero drift
const MOVE_FREQ_TOLERANCE = 0.005; // ±0.5pp — headroom for single-game outcome shifts

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.resolve(__dirname, "../../balance-baseline.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));

const policies = { random: randomPolicy, ai: aiPolicy };

afterEach(() => seed(null));

describe("balance regression", () => {
  const skip = process.env.SKIP_BALANCE_REGRESSION === "1";
  for (const baselineMatchup of baseline.matchups) {
    it.skipIf(skip)(`${baselineMatchup.matchup} matches baseline within tolerance`, () => {
      const [engName, conName] = baselineMatchup.matchup.split("-vs-");
      const current = runBatch({
        startSeed: baselineMatchup.startSeed,
        count: baselineMatchup.count,
        engPolicy: policies[engName],
        conPolicy: policies[conName],
        engPolicyName: engName,
        conPolicyName: conName,
      });

      const winRateDelta = Math.abs(current.engineerWinRate - baselineMatchup.engineerWinRate);
      expect(winRateDelta, `engineer win rate drifted by ${(winRateDelta * 100).toFixed(2)}pp`)
        .toBeLessThanOrEqual(WIN_RATE_TOLERANCE);

      for (const side of ["engineer", "contractor"]) {
        for (const [moveName, baseFreq] of Object.entries(baselineMatchup.moveFrequency[side])) {
          const curFreq = current.moveFrequency[side][moveName] || 0;
          const delta = Math.abs(curFreq - baseFreq);
          expect(delta, `${side} ${moveName} frequency drifted by ${(delta * 100).toFixed(2)}pp`)
            .toBeLessThanOrEqual(MOVE_FREQ_TOLERANCE);
        }
      }
    });
  }

  describe("SKIP_BALANCE_REGRESSION env var", () => {
    it("is honored as a string '1' to skip", () => {
      // This test just asserts the env-gate mechanism exists in the source.
      // The actual skip is verified by Step 3 below: running with the env var
      // set should produce 0 test failures even if the baseline drifted.
      const src = fs.readFileSync(
        path.resolve(__dirname, "./balance-regression.test.js"),
        "utf-8",
      );
      expect(src).toMatch(/process\.env\.SKIP_BALANCE_REGRESSION\s*===\s*["']1["']/);
    });
  });
});
