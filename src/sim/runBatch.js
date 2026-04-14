import { runGame } from "./runGame.js";

export function runBatch({ startSeed, count, engPolicy, conPolicy, engPolicyName, conPolicyName }) {
  if (count <= 0) throw new Error(`runBatch: count must be > 0, got ${count}`);
  let engineerWins = 0;
  let contractorWins = 0;
  let draws = 0;
  let totalTurns = 0;
  const totals = { engineer: {}, contractor: {} };

  for (let i = 0; i < count; i++) {
    const { winner, turns, moveCount } = runGame({
      seed: startSeed + i,
      engPolicy,
      conPolicy,
    });
    if (winner === "engineer") engineerWins++;
    else if (winner === "contractor") contractorWins++;
    else draws++;
    totalTurns += turns;
    for (const side of ["engineer", "contractor"]) {
      for (const [name, n] of Object.entries(moveCount[side])) {
        totals[side][name] = (totals[side][name] || 0) + n;
      }
    }
  }

  const moveFrequency = { engineer: {}, contractor: {} };
  for (const side of ["engineer", "contractor"]) {
    const sum = Object.values(totals[side]).reduce((a, b) => a + b, 0) || 1;
    for (const [name, n] of Object.entries(totals[side])) {
      moveFrequency[side][name] = +(n / sum).toFixed(4);
    }
  }

  return {
    matchup: `${engPolicyName}-vs-${conPolicyName}`,
    startSeed,
    count,
    engineerWinRate: +(engineerWins / count).toFixed(4),
    contractorWinRate: +(contractorWins / count).toFixed(4),
    drawRate: +(draws / count).toFixed(4),
    avgTurns: +(totalTurns / count).toFixed(2),
    moveFrequency,
  };
}
