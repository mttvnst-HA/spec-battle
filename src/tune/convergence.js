// Pure convergence/improvement math for the tuning loop.
// No I/O. All inputs are two-matchup reports: { matchups: [BalanceReport, BalanceReport] }.

const BAND_LOW = 0.45;
const BAND_HIGH = 0.55;
const CROSS_MATCHUP_TOLERANCE = 0.02; // 2pp
const EPSILON = 1e-9;                 // tolerate floating-point noise in comparisons

export function distance(matchup) {
  return Math.abs(matchup.engineerWinRate - 0.5);
}

export function worst(report) {
  return Math.max(...report.matchups.map(distance));
}

export function isConverged(history) {
  if (history.length < 3) return false;
  const lastThree = history.slice(-3);
  return lastThree.every((report) =>
    report.matchups.every(
      (m) => m.engineerWinRate >= BAND_LOW && m.engineerWinRate <= BAND_HIGH,
    ),
  );
}

export function isImprovement(prev, curr) {
  if (worst(curr) >= worst(prev) - EPSILON) return false;
  // No matchup may regress by more than CROSS_MATCHUP_TOLERANCE.
  for (let i = 0; i < prev.matchups.length; i++) {
    const regression = distance(curr.matchups[i]) - distance(prev.matchups[i]);
    if (regression > CROSS_MATCHUP_TOLERANCE + EPSILON) return false;
  }
  return true;
}
