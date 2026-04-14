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

// ---- parseBundle ----

const TARGET_RE = /^(GAME\.[a-zA-Z]+|(?:engineer|contractor)\..+\.(?:dmg|mp))$/;

// Step-size validation per target kind.
function validateStep(target, before, after) {
  if (target.startsWith("GAME.")) {
    const key = target.slice("GAME.".length);
    if (["critRate", "stunChance", "slowChance"].includes(key)) {
      if (typeof before !== "number" || typeof after !== "number") return "rate must be numeric";
      if (Math.abs(after - before) > 0.02 + 1e-9) return `${key} step > 0.02`;
      if (after < 0 || after > 1) return `${key} out of [0,1]`;
      return null;
    }
    if (["critMultiplier", "weakenedMultiplier", "defMultiplier"].includes(key)) {
      if (typeof before !== "number" || typeof after !== "number") return "multiplier must be numeric";
      if (Math.abs(after - before) > 0.05 + 1e-9) return `${key} step > 0.05`;
      if (after <= 0) return `${key} must be > 0`;
      return null;
    }
    if (key === "mpRegen") {
      if (!Number.isInteger(before) || !Number.isInteger(after)) return "mpRegen must be integer";
      if (Math.abs(after - before) > 1) return "mpRegen step > 1";
      if (after < 0) return "mpRegen must be >= 0";
      return null;
    }
    if (key === "healRange") {
      if (!Array.isArray(before) || before.length !== 2) return "healRange before must be [min,max]";
      if (!Array.isArray(after) || after.length !== 2) return "healRange after must be [min,max]";
      if (!after.every(Number.isInteger)) return "healRange values must be integers";
      if (Math.abs(after[0] - before[0]) > 2) return "healRange min step > 2";
      if (Math.abs(after[1] - before[1]) > 1) return "healRange max step > 1";
      if (after[0] > after[1]) return "healRange min > max";
      return null;
    }
    return `unknown GAME.${key}`;
  }
  // Move target: <side>.<name>.<field>
  if (target.endsWith(".dmg")) {
    if (!Array.isArray(before) || before.length !== 2) return "dmg before must be [min,max]";
    if (!Array.isArray(after) || after.length !== 2) return "dmg after must be [min,max]";
    if (!after.every(Number.isInteger)) return "dmg values must be integers";
    if (after[0] !== before[0] - 1 && after[0] !== before[0] + 1 && after[0] !== before[0])
      return "dmg[0] step must be -1, 0, or +1";
    if (after[1] !== before[1] - 1 && after[1] !== before[1] + 1 && after[1] !== before[1])
      return "dmg[1] step must be -1, 0, or +1";
    if (after[0] > after[1]) return "dmg min > max";
    if (after[0] < 0) return "dmg min < 0";
    return null;
  }
  if (target.endsWith(".mp")) {
    if (!Number.isInteger(before) || !Number.isInteger(after)) return "mp must be integer";
    if (Math.abs(after - before) > 1) return "mp step > 1";
    if (after < 0) return "mp must be >= 0";
    return null;
  }
  return "unknown field";
}

// Deep equal for scalars + 2-element arrays (the only shapes we use).
function sameBefore(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

// Read the actual current value from currentState for a given target.
function resolveCurrent(currentState, target) {
  if (target.startsWith("GAME.")) {
    const key = target.slice("GAME.".length);
    if (!(key in currentState.GAME)) return { ok: false, error: `unknown key GAME.${key}` };
    return { ok: true, value: currentState.GAME[key] };
  }
  const firstDot = target.indexOf(".");
  const lastDot = target.lastIndexOf(".");
  const side = target.slice(0, firstDot);
  const field = target.slice(lastDot + 1);
  const name = target.slice(firstDot + 1, lastDot);
  const move = currentState.moves[side]?.find((m) => m.name === name);
  if (!move) return { ok: false, error: `no move ${side}.${name}` };
  if (!(field in move)) return { ok: false, error: `move ${name} has no field ${field}` };
  return { ok: true, value: move[field] };
}

// Find the first balanced {...} in a string, respecting string literals.
function firstBalancedObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function extractInnerJson(rawCliOutput) {
  // Step 1: try envelope parse first.
  try {
    const envelope = JSON.parse(rawCliOutput);
    if (envelope && typeof envelope.result === "string") return envelope.result;
  } catch {
    // Not a JSON envelope — treat the raw output as the inner content directly.
  }
  return rawCliOutput;
}

function tryParseAsBundleObject(inner) {
  // Step 2: direct parse.
  try { return { ok: true, obj: JSON.parse(inner) }; } catch {}
  // Step 3: strip code fences.
  const fenceMatch = inner.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try { return { ok: true, obj: JSON.parse(fenceMatch[1]) }; } catch {}
  }
  // Step 4: first balanced object.
  const firstObj = firstBalancedObject(inner);
  if (firstObj) {
    try { return { ok: true, obj: JSON.parse(firstObj) }; } catch {}
  }
  return { ok: false, error: "could not parse JSON from CLI output (tried envelope, fence-strip, brace-extract)" };
}

/**
 * @param {string} rawCliOutput - raw stdout from claude -p --output-format json
 * @param {Object} currentState - { GAME, moves } from readConfig()
 * @returns {{ok: true, bundle: Object} | {ok: false, error: string}}
 */
export function parseBundle(rawCliOutput, currentState) {
  const inner = extractInnerJson(rawCliOutput);
  const parsed = tryParseAsBundleObject(inner);
  if (!parsed.ok) return parsed;
  const obj = parsed.obj;

  // Schema validation.
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "bundle must be a JSON object" };
  if (typeof obj.rule !== "string" || obj.rule.length === 0) return { ok: false, error: "bundle.rule must be non-empty string" };
  if (typeof obj.summary !== "string" || obj.summary.length === 0) return { ok: false, error: "bundle.summary must be non-empty string" };
  if (obj.summary.length > 200) return { ok: false, error: "bundle.summary too long (>200 chars)" };
  if (!Array.isArray(obj.targets) || obj.targets.length === 0) return { ok: false, error: "bundle.targets must be a non-empty array" };

  for (let i = 0; i < obj.targets.length; i++) {
    const t = obj.targets[i];
    if (!t || typeof t !== "object") return { ok: false, error: `targets[${i}] must be object` };
    if (typeof t.target !== "string") return { ok: false, error: `targets[${i}].target must be string` };
    if (!TARGET_RE.test(t.target)) return { ok: false, error: `targets[${i}].target '${t.target}' fails grammar` };

    const resolved = resolveCurrent(currentState, t.target);
    if (!resolved.ok) return { ok: false, error: `targets[${i}]: ${resolved.error}` };
    if (!sameBefore(t.before, resolved.value)) {
      return { ok: false, error: `targets[${i}].before was ${JSON.stringify(t.before)} but current is ${JSON.stringify(resolved.value)}` };
    }

    const stepErr = validateStep(t.target, t.before, t.after);
    if (stepErr) return { ok: false, error: `targets[${i}]: ${stepErr}` };
  }

  return { ok: true, bundle: { rule: obj.rule, summary: obj.summary, targets: obj.targets } };
}

// ---- createLlmProposer ----

/**
 * @param {Object} deps
 * @param {{ send(prompt: string): string }} deps.transport  - from createCliTransport
 * @param {() => Object} [deps.getCurrentState]              - defaults to readConfig(); injectable for tests
 * @returns {{ propose(report, iteration, history, opts?): ProposeResult }}
 */
export function createLlmProposer({ transport, getCurrentState = readConfig }) {
  return {
    propose(report, iteration, history, opts = {}) {
      const currentState = getCurrentState();
      const prompt = buildPrompt({
        currentState,
        currentReport: report,
        history: history ?? [],
        retryError: opts.retryError,
      });

      let raw;
      try {
        raw = transport.send(prompt);
      } catch (err) {
        // Non-recoverable transport failure (CLI missing, timeout, etc.).
        // Return null so the loop stops with reason "exhausted".
        return null;
      }

      return parseBundle(raw, currentState);
    },
  };
}
