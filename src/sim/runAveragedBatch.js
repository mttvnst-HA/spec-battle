// Phase 2.2d — multi-seed averaged sim.
//
// Runs K independent runBatch chunks with disjoint seed ranges and returns a
// single BalanceReport with averaged scalar fields. Drops per-matchup stderr
// by √K so the LLM proposer's single-step mutations become distinguishable
// from binomial noise inside isImprovement's strict-inequality gate.
//
// Used by scripts/tune.js only. scripts/simulate.js and balance-baseline.json
// remain single-seed — averaging is tune-only.

import { runBatch } from "./runBatch.js";

/**
 * @param {Object} args
 * @param {number} args.startSeed
 * @param {number} args.count           - Games per chunk (aggregate = count * seedChunks).
 * @param {number} args.seedChunks      - K; number of independent chunks (>=1).
 * @param {Function} args.engPolicy
 * @param {Function} args.conPolicy
 * @param {string} args.engPolicyName
 * @param {string} args.conPolicyName
 * @returns {BalanceReport}
 */
export function runAveragedBatch({
  startSeed,
  count,
  seedChunks,
  engPolicy,
  conPolicy,
  engPolicyName,
  conPolicyName,
}) {
  if (!Number.isInteger(seedChunks) || seedChunks < 1) {
    throw new Error(`runAveragedBatch: seedChunks must be a positive integer, got ${seedChunks}`);
  }

  // Passthrough: K=1 is exactly runBatch, no averaging overhead or wrapper diff.
  if (seedChunks === 1) {
    return runBatch({ startSeed, count, engPolicy, conPolicy, engPolicyName, conPolicyName });
  }

  const chunks = [];
  for (let k = 0; k < seedChunks; k++) {
    chunks.push(runBatch({
      startSeed: startSeed + k * count,
      count,
      engPolicy,
      conPolicy,
      engPolicyName,
      conPolicyName,
    }));
  }

  const mean = (pick) => chunks.reduce((acc, c) => acc + pick(c), 0) / seedChunks;

  // moveFrequency: union of keys across chunks; missing keys contribute 0.
  const avgMoveFrequency = { engineer: {}, contractor: {} };
  for (const side of ["engineer", "contractor"]) {
    const keys = new Set();
    for (const c of chunks) {
      for (const k of Object.keys(c.moveFrequency[side])) keys.add(k);
    }
    for (const key of keys) {
      const sum = chunks.reduce((acc, c) => acc + (c.moveFrequency[side][key] ?? 0), 0);
      avgMoveFrequency[side][key] = +(sum / seedChunks).toFixed(4);
    }
  }

  return {
    matchup: `${engPolicyName}-vs-${conPolicyName}`,
    startSeed,
    count: count * seedChunks,
    engineerWinRate: +mean((c) => c.engineerWinRate).toFixed(4),
    contractorWinRate: +mean((c) => c.contractorWinRate).toFixed(4),
    drawRate: +mean((c) => c.drawRate).toFixed(4),
    avgTurns: +mean((c) => c.avgTurns).toFixed(2),
    moveFrequency: avgMoveFrequency,
  };
}
