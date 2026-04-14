import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBatch } from "../sim/runBatch.js";
import { randomPolicy, aiPolicy } from "../sim/policies.js";
import { seed } from "../game/rng.js";

const WIN_RATE_TOLERANCE = 0.03;  // ±3pp
const MOVE_FREQ_TOLERANCE = 0.05; // ±5pp

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.resolve(__dirname, "../../balance-baseline.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));

const policies = { random: randomPolicy, ai: aiPolicy };

afterEach(() => seed(null));

describe("balance regression", () => {
  for (const baselineMatchup of baseline.matchups) {
    it(`${baselineMatchup.matchup} matches baseline within tolerance`, () => {
      const [engName, , conName] = baselineMatchup.matchup.split("-");
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
});
