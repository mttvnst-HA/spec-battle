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

CRITICAL DOMAIN ACCURACY — UFS 1-300-02 §2-4.4 EDITORIAL RULES:

Modern UFGS specifications (Unified Facilities Guide Specifications) follow the editorial
rules in UFS 1-300-02 §2-4.4, which PROHIBIT a long list of words and phrases that older
spec writers (and a lot of the engineer character's dialog) habitually use. Spec-knowledgeable
players will catch this. Rather than ignore it, LEAN INTO IT — the cognitive dissonance is
the joke.

Prohibited per §2-4.4 (do NOT cite these as legitimate spec language):
- "shall" — "The use of 'shall' is prohibited." Modern UFGS uses imperative mood ("Install
  equipment") or "must" for non-Contractor subjects. The engineer's signature INVOKE SHALL
  move is therefore a 30-year-vet anachronism: he wields a word his own organization banned.
  Contractor PM should be aware enough to occasionally needle him for it ("§2-4.4 called,
  it wants its mandatory verb back"). Engineer doubles down because that's who he is.
- "should" in body text (recommendations only; permitted in designer notes)
- "as shown on the drawings" (frequently overlooked → unenforceable)
- "as may be required", "as necessary", "as approved/directed/determined by the Contracting
  Officer", "an approved type" (escape clauses)
- "first class workmanship", "in a neat and workmanlike manner", "securely", "thoroughly",
  "suitable", "properly", "good working order", "neatly", "carefully" (vague, unenforceable)
- "in this specification" (refer specifically)
- "Including But Not Limited To" (IBNLT) and conjugations
- "herein", "therein", "thereof", "hereinafter" (Herein family)
- "per" used as "in accordance with" (OK in unit rates: "cfm per ton")
- "/" symbol except in unit rates ("Btu/hr" OK)
- "Contractor must provide X" → just write "Provide X" (specs are already directed to
  Contractor)

DIALOG IMPLICATIONS:
- Engineer occasionally invokes SHALL with full self-awareness it's been banned, and either
  doubles down ("UFS can prohibit it all they like — the legacy contract still says SHALL")
  or rants about modernization rotting spec discipline. Both are in character.
- Contractor weaponizes the prohibited weasel-words: cites "as may be required" or "in a
  neat and workmanlike manner" exactly because they're unenforceable, then dares the engineer
  to define them.
- Engineer has an authentic counter: the prohibited terms are exactly the kind of soft language
  a contractor exploits, so a competent engineer red-lines them OUT of his own specs and into
  the contractor's submittals.
- IBNLT, "herein", and "as shown on the drawings" are all great rhetorical landmines — when
  one side uses them, the other side can pivot to "§2-4.4 violation, that's not enforceable."

For EACH move, document:
- What it is in real federal construction (1-2 sentences)
- The canonical FAR/UFC/UFGS references that back it up
- 3-5 "dialog hooks" — short phrases or rhetorical patterns an in-character NAVFAC
  engineer or contractor PM would actually say when playing this move (for INVOKE SHALL
  specifically, include at least one hook that acknowledges or weaponizes the §2-4.4
  prohibition rather than pretending it doesn't exist)
- For each potential opposing move, a 1-2 sentence note on HOW the move functions
  as a rebuttal (e.g., "OR-EQUAL GAMBIT vs RED-LINE SPEC: contractor frames red-lines
  as preclusive; responds with salient-characteristics argument under Section 01 60 00")

After the per-move sections, add a final section titled "## §2-4.4 EDITORIAL WEAPONS" that
catalogs how each prohibited term/phrase shows up in dialog — engineer railing about it,
contractor exploiting it, or both.

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
