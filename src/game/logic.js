import { C, STATUS, GAME, clamp } from "../constants.js";
import { random, rand, pick } from "./rng.js";
import { CONTRACTOR } from "../data/characters.js";
import { pickDialog } from "./dialog.js";
import { isCounter as checkCounter, getCounterEntry } from "./counters.js";

export function calculateDamage(move, defenderStatus, isCounter = false) {
  let dmg = rand(move.dmg[0], move.dmg[1]);
  if (isCounter) dmg = Math.floor(dmg * GAME.counterMultiplier);
  const crit = random() < GAME.critRate;
  if (crit) dmg = Math.floor(dmg * GAME.critMultiplier);
  if (defenderStatus === STATUS.DEF_PLUS) dmg = Math.floor(dmg * GAME.defMultiplier);
  if (defenderStatus === STATUS.WEAKENED) dmg = Math.floor(dmg * GAME.weakenedMultiplier);
  return { dmg, crit };
}

export function rollStatusEffect(move, isCounter = false) {
  if (move.effect === "weaken") return STATUS.WEAKENED;
  if (move.effect === "stun") {
    if (isCounter) return STATUS.STUNNED;
    if (random() < GAME.stunChance) return STATUS.STUNNED;
  }
  if (move.effect === "slow") {
    if (isCounter) return STATUS.SLOWED;
    if (random() < GAME.slowChance) return STATUS.SLOWED;
  }
  return null;
}

export function resolveMove(state, attacker, move, isPlayer, opponentLastMove = null) {
  let s = { ...state };
  const attackerSide = isPlayer ? "engineer" : "contractor";
  const isOpening = isPlayer ? state.engLastMove == null : state.conLastMove == null;
  const isCounter = checkCounter(attackerSide, move.name, opponentLastMove);
  const quote = pickDialog({ attackerSide, move, opponentLastMove, isOpening });
  let newLog = [
    { text: `${attacker.name} uses ${move.emoji} ${move.name}!`, color: C.bright },
    { text: `  "${quote}"`, color: C.white },
  ];

  if (isCounter) {
    const entry = getCounterEntry(attackerSide, move.name, opponentLastMove);
    newLog.unshift({
      text: `⚔️ COUNTER! ${move.name} vs ${entry.initiator}`,
      color: C.yellow,
    });
  }

  if (isPlayer) { s.engMp = Math.max(0, s.engMp - move.mp); if (move.effect !== "heal") s.engFlash += 1; }
  else { s.conMp = Math.max(0, s.conMp - move.mp); if (move.effect !== "heal") s.conFlash += 1; }

  // Heal
  if (move.effect === "heal") {
    const heal = rand(GAME.healRange[0], GAME.healRange[1]);
    if (isPlayer) s.engHp = clamp(s.engHp + heal, 0, attacker.maxHp);
    else s.conHp = clamp(s.conHp + heal, 0, attacker.maxHp);
    newLog.push({ text: `  Recovered ${heal} HP!`, color: C.hpGreen });
    s.log = [...s.log, ...newLog];
    return s;
  }

  // Defense buff
  if (move.effect === "defense") {
    if (isPlayer) s.engStatus = STATUS.DEF_PLUS; else s.conStatus = STATUS.DEF_PLUS;
    newLog.push({ text: `  Defense raised!`, color: C.cyan });
  }

  // Damage calc (before applying offensive status effects so DEF+ isn't overwritten)
  const defenderStatus = isPlayer ? s.conStatus : s.engStatus;
  const { dmg, crit } = calculateDamage(move, defenderStatus, isCounter);

  if (isPlayer) { s.conHp = Math.max(0, s.conHp - dmg); s.conShake += 1; }
  else { s.engHp = Math.max(0, s.engHp - dmg); s.engShake += 1; }
  newLog.push({ text: `  ${crit ? "CRITICAL HIT! " : ""}${dmg} damage!`, color: crit ? C.yellow : C.red });

  // Status effects applied AFTER damage
  const newStatus = rollStatusEffect(move, isCounter);
  if (newStatus) {
    if (isPlayer) s.conStatus = newStatus; else s.engStatus = newStatus;
    const statusMessages = {
      [STATUS.WEAKENED]: { text: `  Target's defense lowered!`, color: C.orange },
      [STATUS.STUNNED]: { text: `  Target is STUNNED!`, color: C.yellow },
      [STATUS.SLOWED]: { text: `  Target is SLOWED!`, color: C.orange },
    };
    newLog.push(statusMessages[newStatus]);
  }

  s.log = [...s.log, ...newLog];
  return s;
}

export function pickAIMove(state) {
  // Heal if low
  if (state.conHp < 50 && state.conMp >= 15) return CONTRACTOR.moves[2]; // VALUE ENGINEER
  // Use Reserve Rights if weakened
  if (state.conStatus === STATUS.WEAKENED && state.conMp >= 8) return CONTRACTOR.moves[5];
  // Favor big attacks if engineer is low
  if (state.engHp < 40 && state.conMp >= 15) return CONTRACTOR.moves[1]; // CLAIM DSC
  // Weighted random from available
  const avail = CONTRACTOR.moves.filter(m => m.mp <= state.conMp && m.effect !== "heal");
  if (avail.length === 0) return CONTRACTOR.moves[0]; // fallback to RFI
  return pick(avail);
}
