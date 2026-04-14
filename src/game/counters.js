// Canonical counter pairings. Each entry describes:
//   - initiator: the move name played on turn N that this entry counters
//   - counterer: which side is playing the counter move ("engineer" or "contractor")
//   - counterMove: the move name played on turn N+1 that earns the bonus
//
// When (side, move, opponentLastMove) matches an entry, resolveMove applies
// a damage multiplier (GAME.counterMultiplier) AND guarantees any status effect
// the counter move would normally roll for. Dialog is also sourced from the
// move's `vs_<initiator>` bucket.
export const COUNTER_ROUTING = [
  // Engineer counters
  { initiator: "OR-EQUAL GAMBIT", counterer: "engineer",  counterMove: "INVOKE SHALL" },
  { initiator: "CLAIM DSC",        counterer: "engineer",  counterMove: "INVOKE SHALL" },
  { initiator: "VALUE ENGINEER",   counterer: "engineer",  counterMove: "ISSUE NCR" },
  { initiator: "SCHEDULE DELAY",   counterer: "engineer",  counterMove: "CURE NOTICE" },
  { initiator: "SUBMIT RFI",       counterer: "engineer",  counterMove: "CITE UFC" },
  { initiator: "OR-EQUAL GAMBIT",  counterer: "engineer",  counterMove: "RED-LINE SPEC" },
  { initiator: "SUBMIT RFI",       counterer: "engineer",  counterMove: "REJECT SUBMITTAL" },
  // Contractor counters
  { initiator: "CITE UFC",         counterer: "contractor", counterMove: "CLAIM DSC" },
  { initiator: "CURE NOTICE",      counterer: "contractor", counterMove: "RESERVE RIGHTS" },
  { initiator: "ISSUE NCR",        counterer: "contractor", counterMove: "SCHEDULE DELAY" },
  { initiator: "INVOKE SHALL",     counterer: "contractor", counterMove: "SUBMIT RFI" },
  { initiator: "REJECT SUBMITTAL", counterer: "contractor", counterMove: "VALUE ENGINEER" },
  { initiator: "RED-LINE SPEC",    counterer: "contractor", counterMove: "OR-EQUAL GAMBIT" },
];

export function getCounterEntry(attackerSide, moveName, opponentLastMoveName) {
  if (!opponentLastMoveName) return null;
  return COUNTER_ROUTING.find(
    (e) =>
      e.counterer === attackerSide &&
      e.counterMove === moveName &&
      e.initiator === opponentLastMoveName,
  ) || null;
}

export function isCounter(attackerSide, moveName, opponentLastMoveName) {
  return getCounterEntry(attackerSide, moveName, opponentLastMoveName) !== null;
}
