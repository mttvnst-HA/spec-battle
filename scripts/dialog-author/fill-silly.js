#!/usr/bin/env node
// Bucket-targeted dialog authoring tool. Enumerates (attacker-move, prior-move)
// counter pairings, batches them into focused Opus calls ("author N lines for
// each of these K buckets"), and merges results into scratch/dialog-candidates.json
// for human curation. The Opus prompt embeds a rigid tone spec (punchy
// one-liners, ≤3 commas, setup-punch rhythm) matching the App.jsx-era voice.
//
// Usage:
//   node scripts/dialog-author/fill-silly.js --side=both [--count=3] [--batch=8]
//     [--sample-only=3]   # only generate the first N buckets per side (for tone review)
//   node scripts/dialog-author/fill-silly.js --side=both --include-shipped
//     # also overwrite counter buckets that already have curated content shipped

import fs from "node:fs";
import { createCliTransport } from "../../src/tune/claudeTransport.js";

const arg = (name, dflt) => {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.split("=").slice(1).join("=") : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const SIDE = arg("side", "both");
const COUNT = Number(arg("count", "3"));
const BATCH = Number(arg("batch", "8"));
const SAMPLE_ONLY = Number(arg("sample-only", "0"));
const INCLUDE_SHIPPED = flag("include-shipped");

const MOVES_ENG = ["REJECT SUBMITTAL", "RED-LINE SPEC", "INVOKE SHALL", "ISSUE NCR", "CITE UFC", "CURE NOTICE"];
const MOVES_CON = ["SUBMIT RFI", "CLAIM DSC", "VALUE ENGINEER", "SCHEDULE DELAY", "OR-EQUAL GAMBIT", "RESERVE RIGHTS"];
const vsKey = (n) => "vs_" + n.replace(/[ -]/g, "_");

const sourceDoc = fs.existsSync("docs/dialog-source-material.md")
  ? fs.readFileSync("docs/dialog-source-material.md", "utf8")
  : "(source material doc not present — run research.js first)";

const candidatesPath = "scratch/dialog-candidates.json";
const candidates = fs.existsSync(candidatesPath)
  ? JSON.parse(fs.readFileSync(candidatesPath, "utf8"))
  : { engineer: {}, contractor: {} };

const engShipped = JSON.parse(fs.readFileSync("content/quotes/engineer.json", "utf8"));
const conShipped = JSON.parse(fs.readFileSync("content/quotes/contractor.json", "utf8"));

function targetsFor(side, myMoves, oppMoves, shipped) {
  const list = [];
  for (const myMove of myMoves) {
    for (const opp of oppMoves) {
      const key = vsKey(opp);
      const shippedCount = ((shipped[myMove] || {})[key] || []).length;
      if (shippedCount > 0 && !INCLUDE_SHIPPED) continue;
      list.push({ side, myMove, priorMove: opp, key });
    }
  }
  return SAMPLE_ONLY > 0 ? list.slice(0, SAMPLE_ONLY) : list;
}

const transport = createCliTransport({
  model: process.env.TUNE_MODEL || "claude-opus-4-6",
  timeoutMs: Number(process.env.TUNE_TIMEOUT_MS || 600000),
  executable: process.env.TUNE_CLAUDE_BIN ?? "claude",
});

function buildPrompt(batch, sideLabel) {
  const items = batch.map(
    (g, i) =>
      `${i + 1}. ${sideLabel.toUpperCase()} plays "${g.myMove}" immediately after opponent just played "${g.priorMove}". Bucket key: ${g.key}.`
  ).join("\n");

  return `You are authoring in-character dialog lines for SPEC BATTLE RPG — a turn-based
PIXEL-ART FIGHTING GAME between a NAVFAC federal construction ENGINEER and a
CONTRACTOR. Lines are the attacking character's SHOUT-LINE when a move lands.
Game dialog, not a meeting transcript.

STYLE RULES (RIGID):
- 1 sentence. Occasionally 2 short ones. NEVER a paragraph.
- Max ONE clause/section/form number per line, and often ZERO. Prefer natural
  speech ("the 55/45 split", "the submittal") over form-speak ("SD-03 Product
  Data per 52.248-3"). If you have to stack two acronyms, delete the line.
- More than three commas in one sentence = too long. Cut.
- One concept per line. No recursive meta-wordplay (don't write jokes ABOUT
  the joke, like "red-lined your red-line, which red-line is the red-line").
- PREFERRED patterns (most to least):
  1. REDIRECT AT OPPONENT — put the ball back in their court with their own
     pronoun. ("on your desk", "when you file it correctly", "or your mood?")
  2. DISMISS-AND-MOVE-ON — list their options, reject them all, state the
     real issue. ("Type I, Type II, Type-doesn't-matter.")
  3. RULE OF THREE with absurd punchline. ("The spec, the drawings, or your
     mood?")
  4. CONDITIONAL JAB — "I'll [do reasonable thing] WHEN [you do impossible
     thing]."
  5. TAUTOLOGY — "Shall means shall."
- AVOID:
  - Cute-but-toothless metaphors ("red pens reach a settlement")
  - Insider jargon that needs setup ("I killed this one in three" — float
    references only if context makes them obvious)
  - Technical accuracy WITHOUT a joke at the end
  - "Respectfully" used more than once per line — it loses its edge
- Every line MUST land a punch. If reading it aloud in a meeting wouldn't
  make the room wince or laugh, it's not a shout-line.

STUDY THESE ORIGINAL-STYLE LINES (DO NOT reuse — study rhythm and length):
- "This is the third resubmittal. Still non-compliant."
- "Did you even read the review comments?"
- "I highlighted the non-conforming items. In red. The entire page is red."
- "Shall means shall. I don't know how to make that clearer."
- "The NCR is tagged and photographed. Enjoy your CPARS."
- "This is the fourth NCR this month. See the trend?"
- "We're not building a piano. We're building a military facility."
- "Please be advised..."
- "We have submitted 47 RFIs this week. Your response is overdue on 38 of them."
- "We stopped work immediately and preserved the evidence. Our photographer was here before the dust settled."
- "We bid the expensive product. Now here's a cheaper one. You're welcome."
- "It meets the MINIMUM requirements. That's what minimum means."
- "Month 1: on schedule. Month 6: the schedule narrative reads like a legal brief."
- "Who owns the float? We do. Obviously."
- "Blame weather, supply chain, the tides, and your RFI response time."
- "Other engineers have let us substitute this on every other project."
- "Our sub says it meets spec. Their rep confirmed it. Verbally. Probably."
- "Only the Contracting Officer can bind the Government. You're the COR."
- "Have you been keeping daily logs? Good. They're evidence now."

VOICES:
- ENGINEER: Gruff, clipped, chip on shoulder. Writes notes with a red pen.
  Knows §2-4.4 banned SHALL and invokes it anyway because he's been doing
  this since Clinton was president. Deadpan. Mostly out of patience.
- CONTRACTOR PM: The comedy is SHAMELESS MATTER-OF-FACT HONESTY about the
  hustle — they just ADMIT the play with a straight face. NOT performative
  politeness. The original-style contractor lines that WORK:
    "We bid the expensive product. Now here's a cheaper one. You're welcome."
    "It meets the MINIMUM requirements. That's what minimum means."
    "We have submitted 47 RFIs this week. Your response is overdue on 38."
    "Our sub says it meets spec. Their rep confirmed it. Verbally. Probably."
    "Other engineers have let us substitute this on every other project."
    "Have you been keeping daily logs? Good. They're evidence now."
    "Blame weather, supply chain, the tides, and your RFI response time."
  Contractor PATTERNS that land:
    1. ADMIT THE PLAY — state the obvious tactic as if it's reasonable.
    2. QUANTIFIED EXASPERATION — specific counts that imply a backlog.
    3. EROSION OF CERTAINTY — end on "probably" / "we think" / "our guy said."
    4. PEER PRESSURE — "on every other project", "other engineers", "Base
       approved this at Building 101."
    5. MISPLACED COMPLIMENT — thank or praise the engineer for something
       that isn't what they did.
    6. TAUTOLOGY DISGUISED AS COURTESY — "the answer may be in the documents
       but we'd like it in writing."
  AVOID: Repeating "respectfully" / "without prejudice" as a crutch. Use
  each at MOST once per line, and only when it IS the joke (e.g. the entire
  joke is the gap between politeness and the knife). Don't lean on RFI
  numbers as the punchline — the number is flavor, the joke is elsewhere.

Authoritative domain reference (clause numbers, §2-4.4 — reference sparingly
for flavor, DO NOT cite multiple clauses per line):
---
${sourceDoc}
---

TASK: For each of the following (attacker-move, prior-move) pairings, author
exactly ${COUNT} distinct SILLY in-character lines that ${sideLabel} delivers
when playing attacker-move directly in response to opponent's prior-move.
- Specifically reference prior-move content (not generic)
- Land a specific clause/number/§
- Include the comedic edge (one of the patterns above; vary across the ${COUNT})
- 1-2 sentences, game-dialog length (NOT a paragraph)
- Distinct angles per line — no near-duplicates

BUCKETS TO AUTHOR:
${items}

OUTPUT FORMAT: JSON object mapping bucket key → array of strings. No preamble,
no code fences. Example:
{"vs_CLAIM_DSC": ["line one", "line two", "line three"]}

Return the JSON object only.`;
}

async function fillSide(sideLabel, myMoves, oppMoves, shipped) {
  const targets = targetsFor(sideLabel, myMoves, oppMoves, shipped);
  console.log(`${sideLabel}: ${targets.length} buckets to regenerate`);
  if (targets.length === 0) return;

  const batches = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    batches.push(targets.slice(i, i + BATCH));
  }

  for (const [i, batch] of batches.entries()) {
    console.log(`  batch ${i + 1}/${batches.length}: ${batch.length} buckets`);
    const prompt = buildPrompt(batch, sideLabel);
    const raw = transport.send(prompt);
    const parsed = JSON.parse(raw);
    const body = typeof parsed === "string" ? parsed : (parsed.result || parsed.content || "");
    const cleaned = body.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
    let lines;
    try {
      lines = JSON.parse(cleaned);
    } catch (e) {
      console.error(`  batch ${i + 1} parse failed: ${e.message}`);
      console.error(`  body head: ${cleaned.slice(0, 500)}`);
      continue;
    }
    for (const g of batch) {
      const arr = lines[g.key];
      if (!Array.isArray(arr)) {
        console.log(`    MISS ${g.myMove}.${g.key}: model did not return this bucket`);
        continue;
      }
      candidates[sideLabel] = candidates[sideLabel] || {};
      candidates[sideLabel][g.myMove] = candidates[sideLabel][g.myMove] || {};
      // REPLACE the bucket (don't append) — silly tone overrides serious
      candidates[sideLabel][g.myMove][g.key] = arr.filter((l) => typeof l === "string");
      console.log(`    ${arr.length}→${g.myMove}.${g.key}`);
    }
    fs.writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2));
  }
}

if (SIDE === "engineer" || SIDE === "both") {
  await fillSide("engineer", MOVES_ENG, MOVES_CON, engShipped);
}
if (SIDE === "contractor" || SIDE === "both") {
  await fillSide("contractor", MOVES_CON, MOVES_ENG, conShipped);
}
console.log(`Candidates file updated: ${candidatesPath}`);
