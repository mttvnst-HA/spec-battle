// Round-robin heuristic proposer for Phase 2.1.
// Each rule: pure function of (report, config) → Proposal | null.
// propose(report, iteration): tries rules[iteration % N], falls through on null.

import { readConfig } from "./applyProposal.js";

// ---- helpers ----

const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

function dominantSide(report) {
  // Side whose max deviation across matchups is largest.
  // engineerWinRate > 0.5 means engineer is winning.
  const engWorst = Math.max(...report.matchups.map((m) => m.engineerWinRate - 0.5));
  const conWorst = Math.max(...report.matchups.map((m) => 0.5 - m.engineerWinRate));
  if (engWorst > conWorst) return "engineer";
  if (conWorst > engWorst) return "contractor";
  return null;
}

function topUsageMove(report, side) {
  // Aggregate usage across matchups (sum of frequencies).
  const totals = {};
  for (const m of report.matchups) {
    const freq = m.moveFrequency[side] || {};
    for (const [name, f] of Object.entries(freq)) {
      totals[name] = (totals[name] || 0) + f;
    }
  }
  let best = null;
  let bestF = -Infinity;
  for (const [name, f] of Object.entries(totals)) {
    if (f > bestF) { best = name; bestF = f; }
  }
  return best;
}

function topCostMove(side, cfg) {
  // Move with highest mp cost from live config.
  const moves = cfg.moves[side];
  return [...moves].sort((a, b) => b.mp - a.mp)[0];
}

function topTwoCostAvg(side, cfg) {
  const moves = [...cfg.moves[side]].sort((a, b) => b.mp - a.mp);
  if (moves.length < 2) return moves[0]?.mp ?? 0;
  return (moves[0].mp + moves[1].mp) / 2;
}

// ---- rules ----
// Each rule: (report, config) => Proposal | null

function ruleNerfTopUsage(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  // Dominant side must actually be winning.
  const engAvg = avg(report.matchups.map((m) => m.engineerWinRate));
  if (dom === "engineer" && engAvg <= 0.5) return null;
  if (dom === "contractor" && engAvg >= 0.5) return null;

  const moveName = topUsageMove(report, dom);
  if (!moveName) return null;
  const move = cfg.moves[dom].find((m) => m.name === moveName);
  if (!move) return null;

  const [lo, hi] = move.dmg;
  if (hi - 1 >= lo && lo - 1 >= 1) {
    const after = [lo - 1, hi - 1];
    return {
      rule: "nerf-top-usage-move",
      target: `${dom}.${moveName}.dmg`,
      before: [lo, hi],
      after,
      summary: `Nerf ${dom} ${moveName} dmg ${JSON.stringify([lo, hi])} -> ${JSON.stringify(after)}`,
    };
  }
  if (move.mp + 1 <= 30) {
    return {
      rule: "nerf-top-usage-move",
      target: `${dom}.${moveName}.mp`,
      before: move.mp,
      after: move.mp + 1,
      summary: `Raise ${dom} ${moveName} mp ${move.mp} -> ${move.mp + 1}`,
    };
  }
  return null;
}

function ruleBuffWeakTop(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  const weak = dom === "engineer" ? "contractor" : "engineer";
  const move = topCostMove(weak, cfg);
  if (!move) return null;
  const [lo, hi] = move.dmg;
  if (hi + 1 > 60) return null;
  const after = [lo + 1, hi + 1];
  return {
    rule: "buff-weak-side-top-move",
    target: `${weak}.${move.name}.dmg`,
    before: [lo, hi],
    after,
    summary: `Buff ${weak} ${move.name} dmg ${JSON.stringify([lo, hi])} -> ${JSON.stringify(after)}`,
  };
}

function ruleLowerCrit(report, cfg) {
  const meanTurns = avg(report.matchups.map((m) => m.avgTurns));
  if (meanTurns >= 14) return null;
  const before = cfg.GAME.critMultiplier;
  const after = +(before - 0.05).toFixed(2);
  if (after < 1.1) return null;
  return {
    rule: "lower-crit-multiplier",
    target: "GAME.critMultiplier",
    before, after,
    summary: `Lower GAME.critMultiplier ${before} -> ${after}`,
  };
}

function ruleTrimMpRegen(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  const engAvg = avg(report.matchups.map((m) => m.engineerWinRate));
  const winRate = dom === "engineer" ? engAvg : 1 - engAvg;
  if (winRate < 0.6) return null;
  if (topTwoCostAvg(dom, cfg) <= 10) return null;
  const before = cfg.GAME.mpRegen;
  const after = before - 1;
  if (after < 2) return null;
  return {
    rule: "trim-mp-regen",
    target: "GAME.mpRegen",
    before, after,
    summary: `Trim GAME.mpRegen ${before} -> ${after}`,
  };
}

function ruleTameWeaken(report, cfg) {
  const dom = dominantSide(report);
  if (!dom) return null;
  const engAvg = avg(report.matchups.map((m) => m.engineerWinRate));
  const winRate = dom === "engineer" ? engAvg : 1 - engAvg;
  if (winRate < 0.6) return null;
  const before = cfg.GAME.weakenedMultiplier;
  const after = +(before - 0.05).toFixed(2);
  if (after < 1.05) return null;
  return {
    rule: "tame-weaken",
    target: "GAME.weakenedMultiplier",
    before, after,
    summary: `Tame GAME.weakenedMultiplier ${before} -> ${after}`,
  };
}

function ruleRaiseHealFloor(report, cfg) {
  const dom = dominantSide(report);
  if (dom !== "engineer") return null;
  const [lo, hi] = cfg.GAME.healRange;
  const after = [lo + 2, hi];
  if (after[0] > 45 || after[0] > hi) return null;
  return {
    rule: "raise-heal-floor",
    target: "GAME.healRange",
    before: [lo, hi],
    after,
    summary: `Raise GAME.healRange ${JSON.stringify([lo, hi])} -> ${JSON.stringify(after)}`,
  };
}

export const RULES = [
  { name: "nerf-top-usage-move",    fn: ruleNerfTopUsage },
  { name: "buff-weak-side-top-move", fn: ruleBuffWeakTop },
  { name: "lower-crit-multiplier",  fn: ruleLowerCrit },
  { name: "trim-mp-regen",          fn: ruleTrimMpRegen },
  { name: "tame-weaken",            fn: ruleTameWeaken },
  { name: "raise-heal-floor",       fn: ruleRaiseHealFloor },
];

export function propose(report, iteration) {
  const cfg = readConfig();
  const n = RULES.length;
  for (let offset = 0; offset < n; offset++) {
    const rule = RULES[(iteration + offset) % n];
    const p = rule.fn(report, cfg);
    if (p) return p;
  }
  return null;
}
