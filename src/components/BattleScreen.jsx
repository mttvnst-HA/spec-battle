import { useReducer, useEffect } from "react";
import { C, PIXEL_FONT, STATUS, TIMINGS } from "../constants.js";
import { ENGINEER_PIXELS, CONTRACTOR_PIXELS } from "../data/sprites.js";
import { ENGINEER, CONTRACTOR } from "../data/characters.js";
import { reducer, initState, INTRO_SEQUENCE } from "../game/reducer.js";
import { PixelSprite } from "./PixelSprite.jsx";
import { StatBox } from "./StatBox.jsx";
import { LogBox } from "./LogBox.jsx";

export function BattleScreen({ onEnd }) {
  const [state, dispatch] = useReducer(reducer, null, initState);

  // Intro sequence
  useEffect(() => {
    if (state.turn !== "intro") return;
    const timers = [];
    let cumulative = 0;
    INTRO_SEQUENCE.forEach((step, i) => {
      cumulative += step.delay;
      timers.push(setTimeout(() => dispatch({ type: "INTRO_LOG", entry: step.entry }), cumulative));
    });
    cumulative += 800;
    timers.push(setTimeout(() => dispatch({ type: "INTRO_DONE" }), cumulative));
    return () => timers.forEach(clearTimeout);
  }, [state.turn]);

  useEffect(() => {
    if (state.turn === "enemy" && state.busy && !state.winner) {
      const t = setTimeout(() => dispatch({ type: "ENEMY_MOVE" }), TIMINGS.turnDelay);
      return () => clearTimeout(t);
    }
  }, [state.turn, state.busy, state.winner]);

  // Auto-skip player turn when stunned
  useEffect(() => {
    if (state.turn === "player" && state.engStatus === STATUS.STUNNED && !state.winner) {
      const t = setTimeout(() => dispatch({ type: "PLAYER_STUNNED" }), TIMINGS.stunDelay);
      return () => clearTimeout(t);
    }
  }, [state.turn, state.engStatus, state.winner]);

  useEffect(() => {
    if (state.winner) {
      const t = setTimeout(() => onEnd(state.winner), TIMINGS.turnDelay);
      return () => clearTimeout(t);
    }
  }, [state.winner, onEnd]);

  const isStunned = state.turn === "player" && state.engStatus === STATUS.STUNNED;
  const canAct = state.turn === "player" && !state.busy && !state.winner && !isStunned;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 6, padding: "8px 0" }}>
      {/* Battlefield */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 16px", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <StatBox char={ENGINEER} hp={state.engHp} mp={state.engMp} status={state.engStatus} />
          <PixelSprite data={ENGINEER_PIXELS} size={6} shake={state.engShake} flash={state.engFlash} />
        </div>
        <div style={{ fontFamily: PIXEL_FONT, fontSize: 14, color: C.yellow, animation: "rpg-pulse 2s ease-in-out infinite", paddingTop: 40 }}>VS</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <StatBox char={CONTRACTOR} hp={state.conHp} mp={state.conMp} status={state.conStatus} />
          <PixelSprite data={CONTRACTOR_PIXELS} size={6} shake={state.conShake} flash={state.conFlash} flipX />
        </div>
      </div>

      {/* Turn indicator */}
      <div style={{
        fontFamily: PIXEL_FONT, fontSize: 9, textAlign: "center",
        color: state.turn === "player" ? C.bright : C.orange, letterSpacing: 1, padding: "4px 0",
      }}>
        {state.winner ? "" : state.turn === "intro" ? "" : isStunned ? "!! STUNNED !!" : state.turn === "player" ? ">> YOUR TURN <<" : "... CONTRACTOR is reviewing the contract ..."}
      </div>

      {/* Log */}
      <div style={{ flex: "1 1 0", minHeight: 0, padding: "0 12px", display: "flex", flexDirection: "column" }}>
        <LogBox log={state.log} />
      </div>

      {/* Move buttons - 3x2 grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "4px 12px 8px 12px" }}>
        {ENGINEER.moves.map((m, i) => {
          const usable = canAct && m.mp <= state.engMp;
          return (
            <div
              key={i}
              onClick={() => usable && dispatch({ type: "PLAYER_MOVE", move: m })}
              style={{
                fontFamily: PIXEL_FONT, fontSize: 8, padding: "10px 6px",
                background: usable ? C.panel : "#0d1117",
                border: `2px solid ${usable ? C.bright : C.border}`,
                borderRadius: 4, cursor: usable ? "pointer" : "default",
                color: usable ? C.white : C.muted,
                textAlign: "center", lineHeight: 1.5,
                opacity: usable ? 1 : 0.4,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { if (usable) e.currentTarget.style.background = C.dim; }}
              onMouseLeave={e => { e.currentTarget.style.background = usable ? C.panel : "#0d1117"; }}
            >
              <div>{m.emoji} {m.name}</div>
              {m.mp > 0 && <div style={{ color: C.mpBlue, fontSize: 8 }}>({m.mp} MP)</div>}
              <div style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>{m.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
