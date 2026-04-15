#!/usr/bin/env node
// Stage 2b — targeted bucket-fill. Unlike roleplay.js which produces a free-form
// transcript, fill.js enumerates empty/thin (attacker-move, prior-move) pairings
// and batches them into focused Opus calls: "author N lines for each of these
// K buckets." Result merges into scratch/dialog-candidates.json so curation sees
// a unified pool.
//
// Usage:
//   node scripts/dialog-author/fill.js --side=engineer [--count=3] [--batch=8]
//   node scripts/dialog-author/fill.js --side=contractor
//   node scripts/dialog-author/fill.js --side=both
//
// Respects the same env vars as roleplay.js: TUNE_CLAUDE_BIN, TUNE_MODEL,
// TUNE_TIMEOUT_MS.

import fs from "node:fs";
import path from "node:path";
import { createCliTransport } from "../../src/tune/claudeTransport.js";

const arg = (name, dflt) => {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.split("=").slice(1).join("=") : dflt;
};

const SIDE = arg("side", "both");
const COUNT = Number(arg("count", "3"));
const BATCH = Number(arg("batch", "8"));

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

function gapsFor(side, myMoves, oppMoves, shipped) {
  const gaps = [];
  for (const myMove of myMoves) {
    for (const opp of oppMoves) {
      const key = vsKey(opp);
      const shippedCount = (shipped[myMove]?.[key] || []).length;
      const candCount = (candidates[side]?.[myMove]?.[key] || []).length;
      if (shippedCount === 0 && candCount < 2) {
        gaps.push({ side, myMove, priorMove: opp, key, existing: candCount });
      }
    }
  }
  return gaps;
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
game between a NAVFAC federal construction ENGINEER and a CONTRACTOR. The engineer
is a 25-year-veteran, legacy and credentialed, reflexively cites clause numbers,
mourns editorial modernization, uses "shall" with defiant self-awareness that UFS
1-300-02 §2-4.4 prohibits it. The contractor PM is younger, quantitative, tracks
RFIs in Primavera, weaponizes every §2-4.4 escape clause.

Authoritative domain reference (full doc — use it heavily for voice and clause
accuracy):
---
${sourceDoc}
---

TASK: For each of the following (attacker-move, prior-move) pairings, author
exactly ${COUNT} distinct in-character lines that ${sideLabel} delivers when
playing the attacker-move directly in response to the opponent's just-played
prior-move. Each line should:
- Be specific (cite a real clause number or spec section where natural)
- Reference the prior move's content (not generic)
- Stay in the 1-3 sentence range (dialog, not monologue)
- Vary in angle across the ${COUNT} lines for a single bucket (no near-duplicates)

BUCKETS TO AUTHOR:
${items}

OUTPUT FORMAT: JSON object mapping bucket key → array of strings. No preamble,
no code fences.
Example shape:
{"vs_CLAIM_DSC": ["line one...", "line two...", "line three..."],
 "vs_VALUE_ENGINEER": ["line one...", "line two...", "line three..."]}

Return the JSON object only.`;
}

async function fillSide(sideLabel, myMoves, oppMoves, shipped) {
  const gaps = gapsFor(sideLabel, myMoves, oppMoves, shipped);
  console.log(`${sideLabel}: ${gaps.length} gap buckets to fill`);
  if (gaps.length === 0) return;

  const batches = [];
  for (let i = 0; i < gaps.length; i += BATCH) {
    batches.push(gaps.slice(i, i + BATCH));
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
      candidates[sideLabel][g.myMove] = candidates[sideLabel][g.myMove] || {};
      candidates[sideLabel][g.myMove][g.key] = candidates[sideLabel][g.myMove][g.key] || [];
      let added = 0;
      for (const line of arr) {
        if (typeof line !== "string") continue;
        if (!candidates[sideLabel][g.myMove][g.key].includes(line)) {
          candidates[sideLabel][g.myMove][g.key].push(line);
          added++;
        }
      }
      console.log(`    +${added} ${g.myMove}.${g.key}`);
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
