#!/usr/bin/env node
// Stage 3 — aggregate transcripts in scratch/dialog-transcripts/, bucket lines
// by (speaker_move, priorMove), dedup near-matches, emit candidate pool.
//
// Output: scratch/dialog-candidates.json, indexed as
//   { engineer: { REJECT_SUBMITTAL: { default: [...], vs_SUBMIT_RFI: [...] }, ... },
//     contractor: { ... } }
//
// Usage: node scripts/dialog-author/mine.js

import fs from "node:fs";
import path from "node:path";

const DIR = "scratch/dialog-transcripts";
if (!fs.existsSync(DIR)) {
  console.error(`${DIR} does not exist — run roleplay.js first`);
  process.exit(1);
}

const candidates = { engineer: {}, contractor: {} };
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
console.log(`Mining ${files.length} transcripts...`);

function vsKey(n) { return "vs_" + n.replace(/[ -]/g, "_"); }
function bucketKey(priorMove) {
  return priorMove ? vsKey(priorMove) : "default";
}

for (const f of files) {
  const transcript = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  for (const turn of transcript) {
    if (!turn.speaker || !turn.move || !turn.line) continue;
    const side = turn.speaker;
    const move = turn.move;
    const key = bucketKey(turn.priorMove);
    candidates[side][move] = candidates[side][move] || {};
    candidates[side][move][key] = candidates[side][move][key] || [];
    if (!candidates[side][move][key].includes(turn.line)) {
      candidates[side][move][key].push(turn.line);
    }
  }
}

fs.writeFileSync("scratch/dialog-candidates.json", JSON.stringify(candidates, null, 2));
console.log("Wrote scratch/dialog-candidates.json");
