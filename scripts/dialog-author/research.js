#!/usr/bin/env node
// Stage 1 — call Claude CLI to produce a NAVFAC-domain source material doc
// that subsequent role-play sessions use as context. Output is committed to
// docs/dialog-source-material.md for human review/edit before role-play runs.
//
// Usage: node scripts/dialog-author/research.js [--out=docs/dialog-source-material.md]

import fs from "node:fs";
import path from "node:path";
import { createCliTransport } from "../../src/tune/claudeTransport.js";

const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "--out=docs/dialog-source-material.md").split("=")[1];

const prompt = `You are helping author dialog for SPEC BATTLE RPG — a turn-based game
between a NAVFAC federal construction ENGINEER and a CONTRACTOR that draws on real
FAR clauses, UFC/UFGS references, and CMAA industry research.

Produce a Markdown reference document of NAVFAC/FAR adversarial exchanges organized
by the game's 12 moves (6 per character):

ENGINEER MOVES: REJECT SUBMITTAL, RED-LINE SPEC, INVOKE SHALL, ISSUE NCR, CITE UFC, CURE NOTICE
CONTRACTOR MOVES: SUBMIT RFI, CLAIM DSC, VALUE ENGINEER, SCHEDULE DELAY, OR-EQUAL GAMBIT, RESERVE RIGHTS

For EACH move, document:
- What it is in real federal construction (1-2 sentences)
- The canonical FAR/UFC/UFGS references that back it up
- 3-5 "dialog hooks" — short phrases or rhetorical patterns an in-character NAVFAC
  engineer or contractor PM would actually say when playing this move
- For each potential opposing move, a 1-2 sentence note on HOW the move functions
  as a rebuttal (e.g., "OR-EQUAL GAMBIT vs RED-LINE SPEC: contractor frames red-lines
  as preclusive; responds with salient-characteristics argument under Section 01 60 00")

This document becomes the knowledge base for agent role-play sessions that generate
game dialog. Prioritize accuracy to real NAVFAC practice, humor that insiders will
recognize, and specificity (clause numbers, section numbers, realistic PM vocabulary).

Respond with the Markdown body only — no preamble, no code fences.`;

const transport = createCliTransport({
  model: process.env.TUNE_MODEL || "claude-sonnet-4-6",
  timeoutMs: Number(process.env.TUNE_TIMEOUT_MS || 180000),
  executable: process.env.TUNE_CLAUDE_BIN ?? "claude",
});

const raw = transport.send(prompt);
const parsed = JSON.parse(raw);
const body = typeof parsed === "string" ? parsed : (parsed.result || parsed.content || JSON.stringify(parsed));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`Wrote ${OUT} (${body.length} chars)`);
