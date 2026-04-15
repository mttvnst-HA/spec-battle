#!/usr/bin/env node
// Stage 2 — run one role-play session between engineer and contractor personas.
// Output: scratch/dialog-transcripts/session-<timestamp>.json.
//
// Usage: node scripts/dialog-author/roleplay.js [--turns=8] [--starter=contractor]

import fs from "node:fs";
import path from "node:path";
import { createCliTransport } from "../../src/tune/claudeTransport.js";

const TURNS = Number((process.argv.find((a) => a.startsWith("--turns=")) || "--turns=8").split("=")[1]);
const STARTER = (process.argv.find((a) => a.startsWith("--starter=")) || "--starter=contractor").split("=")[1];

const sourceDoc = fs.existsSync("docs/dialog-source-material.md")
  ? fs.readFileSync("docs/dialog-source-material.md", "utf8")
  : "(source material doc not present — run research.js first)";

const prompt = `You will role-play a ${TURNS}-turn exchange between two characters in
SPEC BATTLE RPG, starting with the ${STARTER.toUpperCase()}.

ENGINEER (NAVFAC): grizzled federal construction engineer with 30 years of experience,
a stack of NCRs, and zero patience for contractor games. Talks in terms of contract
language, UFC/UFGS clauses, and submittal discipline.

CONTRACTOR (PM): slick construction project manager with paper-trail instincts,
strategic RFI submission, and a talent for framing every engineer decision as a
constructive change or differing site condition.

Each turn, the speaker picks ONE of their 6 moves and delivers ONE in-character line
of dialog specific to the prior turn's move. Moves available:

ENGINEER: REJECT SUBMITTAL, RED-LINE SPEC, INVOKE SHALL, ISSUE NCR, CITE UFC, CURE NOTICE
CONTRACTOR: SUBMIT RFI, CLAIM DSC, VALUE ENGINEER, SCHEDULE DELAY, OR-EQUAL GAMBIT, RESERVE RIGHTS

Source material (NAVFAC/FAR reference):
---
${sourceDoc.slice(0, 8000)}
---

Output a JSON array of objects: [{ turn: 1, speaker: "contractor", move: "SUBMIT RFI",
priorMove: null, line: "..." }, ...]. No preamble, no fences, JSON only.`;

const transport = createCliTransport({
  model: process.env.TUNE_MODEL || "claude-sonnet-4-6",
  timeoutMs: Number(process.env.TUNE_TIMEOUT_MS || 180000),
  executable: process.env.TUNE_CLAUDE_BIN ?? "claude",
});

const raw = transport.send(prompt);
const parsed = JSON.parse(raw);
const text = typeof parsed === "string" ? parsed : (parsed.result || parsed.content || "");
// Strip any accidental code fences
const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
const transcript = JSON.parse(cleaned);

fs.mkdirSync("scratch/dialog-transcripts", { recursive: true });
const outPath = `scratch/dialog-transcripts/session-${Date.now()}.json`;
fs.writeFileSync(outPath, JSON.stringify(transcript, null, 2));
console.log(`Wrote ${outPath} (${transcript.length} turns)`);
