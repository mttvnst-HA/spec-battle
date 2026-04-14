import { C, STATUS, GAME, rand, pick, clamp } from "../constants.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";

export function calculateDamage(move, defenderStatus) {
  let dmg = rand(move.dmg[0], move.dmg[1]);
  const crit = Math.random() < GAME.critRate;
  if (crit) dmg = Math.floor(dmg * GAME.critMultiplier);
  if (defenderStatus === STATUS.DEF_PLUS) dmg = Math.floor(dmg * GAME.defMultiplier);
  if (defenderStatus === STATUS.WEAKENED) dmg = Math.floor(dmg * GAME.weakenedMultiplier);
  return { dmg, crit };
}

export function rollStatusEffect(move) {
  if (move.effect === "weaken") return STATUS.WEAKENED;
  if (move.effect === "stun" && Math.random() < GAME.stunChance) return STATUS.STUNNED;
  if (move.effect === "slow" && Math.random() < GAME.slowChance) return STATUS.SLOWED;
  return null;
}

export function resolveMove(state, attacker, move, isPlayer) {
  let s = { ...state };
  const quote = pick(move.quotes);
  let newLog = [
    { text: `${attacker.name} uses ${move.emoji} ${move.name}!`, color: C.bright },
    { text: `  "${quote}"`, color: C.white },
  ];

  if (isPlayer) { s.engMp = Math.max(0, s.engMp - move.mp); if (move.effect !== "heal") s.engFlash += 1; }
  else { s.conMp = Math.max(0, s.conMp - move.mp); if (move.effect !== "heal") s.conFlash += 1; }

  // Dud move — engineer walk-off bluff does nothing
  if (move.dud && isPlayer) {
    newLog.push({ text: `  Nothing happened. ENGINEER returns to their desk.`, color: C.muted });
    s.log = [...s.log, ...newLog];
    return s;
  }

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
  const { dmg, crit } = calculateDamage(move, defenderStatus);

  if (isPlayer) { s.conHp = Math.max(0, s.conHp - dmg); s.conShake += 1; }
  else { s.engHp = Math.max(0, s.engHp - dmg); s.engShake += 1; }
  newLog.push({ text: `  ${crit ? "CRITICAL HIT! " : ""}${dmg} damage!`, color: crit ? C.yellow : C.red });

  // Status effects applied AFTER damage
  const newStatus = rollStatusEffect(move);
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

export function applyOwnerPayment(state, isEngineerTurn) {
  let s = { ...state };
  if (isEngineerTurn) {
    const paperworkFailed = Math.random() < GAME.paperworkFailChance;
    if (paperworkFailed) {
      s.log = [...s.log, { text: `  [OWNER] Engineer invoice rejected — missing DD Form 1149. No payment.`, color: C.orange }];
    } else {
      const payment = GAME.engPayment;
      s.ownerBudget = Math.max(0, s.ownerBudget - payment);
      s.engHp = clamp(s.engHp + payment, 0, ENGINEER.maxHp);
      s.log = [...s.log, { text: `  [OWNER \u2192 ENG] Fixed fee: $${payment}. Owner budget: $${s.ownerBudget}`, color: C.moneyGold }];
    }
  } else {
    const payment = rand(GAME.conPayMin, GAME.conPayMax);
    s.ownerBudget = Math.max(0, s.ownerBudget - payment);
    s.conHp = clamp(s.conHp + payment, 0, CONTRACTOR.maxHp);
    s.conProfits = s.conProfits + payment;
    s.log = [...s.log, { text: `  [OWNER \u2192 CON] Progress payment: $${payment}. Profits: $${s.conProfits}`, color: C.cyan }];
  }
  return s;
}

export function pickAIMove(state) {
  // Walk Off Threat when unlocked and affordable and engineer isn't near death already
  if (state.walkOffUnlocked && state.conMp >= 20 && state.engHp > 50) {
    return CONTRACTOR.moves[6]; // WALK OFF THREAT
  }
  // Heal if low
  if (state.conHp < 50 && state.conMp >= 15) return CONTRACTOR.moves[2]; // VALUE ENGINEER
  // Use Reserve Rights if weakened
  if (state.conStatus === STATUS.WEAKENED && state.conMp >= 8) return CONTRACTOR.moves[5];
  // Favor big attacks if engineer is low
  if (state.engHp < 40 && state.conMp >= 15) return CONTRACTOR.moves[1]; // CLAIM DSC
  // Weighted random from available
  const avail = CONTRACTOR.moves.filter(m => !m.walkOffOnly && m.mp <= state.conMp && m.effect !== "heal");
  if (avail.length === 0) return CONTRACTOR.moves[0]; // fallback to RFI
  return pick(avail);
}
