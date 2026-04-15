import { describe, it, expect, beforeEach } from "vitest";
import { reducer, initState } from "../game/reducer.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { COUNTER_ROUTING } from "../game/counters.js";
import { STATUS, GAME } from "../constants.js";
import { seed } from "../game/rng.js";

function moveByName(character, name) {
  return character.moves.find((m) => m.name === name);
}

function playCounter({ initiator, counterer, counterMove }) {
  seed(1);
  // Set up state where the opponent has "just played" the initiator — we
  // drive this by seeding state.{con|eng}LastMove rather than actually playing
  // the previous turn, to keep test state minimal.
  const base = initState();
  if (counterer === "engineer") {
    const mv = moveByName(ENGINEER, counterMove);
    const state = { ...base, turn: "player", conLastMove: initiator, engMp: 100 };
    return { state, action: { type: "PLAYER_MOVE", move: mv }, counterMove: mv };
  } else {
    const mv = moveByName(CONTRACTOR, counterMove);
    const state = { ...base, turn: "enemy", engLastMove: initiator, conMp: 100 };
    return { state, action: { type: "ENEMY_MOVE", move: mv }, counterMove: mv };
  }
}

describe("canonical counter integration", () => {
  COUNTER_ROUTING.forEach((entry) => {
    const label = `${entry.counterer} counters '${entry.initiator}' with '${entry.counterMove}'`;
    describe(label, () => {
      it("emits ⚔️ COUNTER log line", () => {
        const { state, action } = playCounter(entry);
        const s = reducer(state, action);
        const line = s.log.find((e) => e.text.startsWith("⚔️ COUNTER"));
        expect(line, `missing counter line for ${label}`).toBeDefined();
        expect(line.text).toContain(entry.counterMove);
        expect(line.text).toContain(entry.initiator);
      });

      it("applies counter damage multiplier (dmg ≥ Math.floor(base.min × counterMultiplier))", () => {
        const { state, action, counterMove } = playCounter(entry);
        // Non-damage moves (heals/buffs) don't produce a damage log line — skip.
        if (counterMove.effect === "heal" || counterMove.dmg[1] === 0) return;
        const s = reducer(state, action);
        const dmgLine = s.log.find((e) => e.text.match(/damage!/));
        expect(dmgLine).toBeDefined();
        const dmg = parseInt(dmgLine.text.match(/(\d+) damage/)[1], 10);
        expect(dmg).toBeGreaterThanOrEqual(Math.floor(counterMove.dmg[0] * GAME.counterMultiplier));
      });

      it("guarantees status when the counter move has stun/slow/weaken", () => {
        const { state, action, counterMove } = playCounter(entry);
        const s = reducer(state, action);
        if (counterMove.effect === "stun") {
          if (entry.counterer === "engineer") expect(s.conStatus).toBe(STATUS.STUNNED);
          else expect(s.engStatus).toBe(STATUS.STUNNED);
        } else if (counterMove.effect === "slow") {
          if (entry.counterer === "engineer") expect(s.conStatus).toBe(STATUS.SLOWED);
          else expect(s.engStatus).toBe(STATUS.SLOWED);
        } else if (counterMove.effect === "weaken") {
          if (entry.counterer === "engineer") expect(s.conStatus).toBe(STATUS.WEAKENED);
          else expect(s.engStatus).toBe(STATUS.WEAKENED);
        }
      });

      it("sources quote from the vs_* bucket (seed content from Tasks 11-12 required)", () => {
        const { state, action, counterMove } = playCounter(entry);
        const s = reducer(state, action);
        const vsKeyForMove = "vs_" + entry.initiator.replace(/[ -]/g, "_");
        const expectedLines = counterMove.quotes[vsKeyForMove] || [];
        expect(expectedLines.length, `seed content missing at ${counterMove.name}.${vsKeyForMove}`).toBeGreaterThan(0);
        const quoteLine = s.log.find((e) => e.text.startsWith("  \""));
        expect(quoteLine).toBeDefined();
        const matched = expectedLines.some((line) => quoteLine.text.includes(line));
        expect(matched, `quote line '${quoteLine.text}' not from ${vsKeyForMove}`).toBe(true);
      });
    });
  });
});
