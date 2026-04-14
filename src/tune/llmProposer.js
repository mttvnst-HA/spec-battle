// LLM-backed proposer: buildPrompt + parseBundle + createLlmProposer.
// Pure logic — zero I/O. Imports readConfig from applyProposal only for
// createLlmProposer's propose (Task 6); buildPrompt takes currentState as input.

import { readConfig } from "./applyProposal.js";

// ---- static prompt prefix (cache boundary) ----

const STATIC_PREFIX = `# Role
You are a balance tuner for spec-battle, a turn-based RPG where an
ENGINEER fights a CONTRACTOR using federal-construction-spec language.
Your job is to propose small numeric tweaks to move the simulated
engineer win rate toward 50% in both matchups (random-vs-random and
random-vs-ai).

# Target grammar (STRICT)
Every target in your bundle MUST match one of these two patterns:
- \`GAME.<key>\` — edits content/game.json
- \`<side>.<moveName>.<field>\` — edits content/moves/<side>.json where
  side ∈ {engineer, contractor} and field ∈ {dmg, mp}

# Step-size bounds (REJECTED if exceeded)
- dmg: must be a [min, max] array of integers; shift both bounds by ±1 only
- mp: integer, shift by ±1 only
- GAME rates (critRate, stunChance, slowChance): shift by ±0.02 only, stay in [0, 1]
- GAME multipliers (critMultiplier, weakenedMultiplier, defMultiplier): shift by ±0.05 only, stay > 0
- GAME.mpRegen: integer, shift by ±1 only, stay ≥ 0
- GAME.healRange: [min, max] ints; min shift by ±2, max shift by ±1, min ≤ max

# Response format (STRICT)
Respond with ONLY a single JSON object matching this schema — no prose,
no markdown code fences, no commentary:

{
  "rule": "short-label",
  "summary": "one-line rationale, <=80 chars",
  "targets": [
    { "target": "<path>", "before": <current>, "after": <proposed> }
  ]
}

\`targets\` must have at least 1 element. A single-tweak is a 1-element
bundle. \`before\` values must match the current file state exactly —
do NOT guess; copy from the Current content section below.

# Game primer
- 6 moves per side. Engineer 140HP/70MP, Contractor 150HP/60MP.
- Status: STUNNED (skip turn), SLOWED (visual), WEAKENED (+30% dmg taken), DEF+ (−50% dmg taken).
- MP regens by GAME.mpRegen each turn. Crits fire at GAME.critRate with GAME.critMultiplier damage.

`;

// ---- buildPrompt ----

/**
 * @param {Object} args
 * @param {{ GAME: Object, moves: { engineer: Array, contractor: Array } }} args.currentState
 * @param {{ matchups: Array }} args.currentReport
 * @param {HistoryEntry[]} args.history - loop history; this function picks last 3
 * @param {string|undefined} args.retryError - error string from prior parseBundle failure (optional)
 * @returns {string}
 */
export function buildPrompt({ currentState, currentReport, history, retryError }) {
  const dynamicParts = [];

  dynamicParts.push("# Current content");
  dynamicParts.push("## content/game.json");
  dynamicParts.push("```json");
  dynamicParts.push(JSON.stringify(currentState.GAME, null, 2));
  dynamicParts.push("```");
  dynamicParts.push("## content/moves/engineer.json");
  dynamicParts.push("```json");
  dynamicParts.push(JSON.stringify(currentState.moves.engineer, null, 2));
  dynamicParts.push("```");
  dynamicParts.push("## content/moves/contractor.json");
  dynamicParts.push("```json");
  dynamicParts.push(JSON.stringify(currentState.moves.contractor, null, 2));
  dynamicParts.push("```");

  dynamicParts.push("");
  dynamicParts.push("# Current balance report");
  for (const m of currentReport.matchups) {
    const top5 = Object.entries({ ...m.moveFrequency.engineer, ...m.moveFrequency.contractor })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `  ${k}: ${(v * 100).toFixed(1)}%`)
      .join("\n");
    dynamicParts.push(`## ${m.matchup}`);
    dynamicParts.push(`- engineerWinRate: ${(m.engineerWinRate * 100).toFixed(2)}%`);
    dynamicParts.push(`- avgTurns: ${m.avgTurns.toFixed(1)}`);
    dynamicParts.push(`- top-5 move frequencies:\n${top5}`);
  }

  dynamicParts.push("");
  dynamicParts.push("# Recent history (last 3 iterations, oldest first)");
  const recent = history.filter((h) => h.outcome !== "baseline").slice(-3);
  if (recent.length === 0) {
    dynamicParts.push("(no prior iterations)");
  } else {
    dynamicParts.push("```json");
    dynamicParts.push(JSON.stringify(recent.map((h) => {
      const entry = { iteration: h.iteration, bundle: h.bundle, outcome: h.outcome };
      if (h.worstDistanceBefore !== undefined) entry.worstDistanceBefore = +h.worstDistanceBefore.toFixed(4);
      if (h.worstDistanceAfter !== undefined) entry.worstDistanceAfter = +h.worstDistanceAfter.toFixed(4);
      return entry;
    }), null, 2));
    dynamicParts.push("```");
  }

  if (retryError) {
    dynamicParts.push("");
    dynamicParts.push("# Retry context");
    dynamicParts.push(`Your previous response failed validation: ${retryError}`);
    dynamicParts.push("Emit valid JSON only, matching the schema above.");
  }

  dynamicParts.push("");
  dynamicParts.push("# Task");
  dynamicParts.push("Propose one bundle that moves engineer win rate closer to 50% in");
  dynamicParts.push("the worse matchup without regressing the other by more than 2pp.");
  dynamicParts.push("Respond with ONLY the JSON bundle.");

  return STATIC_PREFIX + dynamicParts.join("\n") + "\n";
}
