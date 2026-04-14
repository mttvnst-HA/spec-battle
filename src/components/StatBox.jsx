import { C, PIXEL_FONT, STATUS } from "../constants.js";

function HPBar({ current, max }) {
  const pct = Math.max(0, (current / max) * 100);
  return (
    <div style={{ width: "100%", height: 14, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%",
        background: pct > 50 ? C.hpGreen : pct > 25 ? C.orange : C.hpRed,
        transition: "width 0.5s ease, background 0.5s ease",
      }} />
    </div>
  );
}

function MPBar({ current, max }) {
  const pct = Math.max(0, (current / max) * 100);
  return (
    <div style={{ width: "100%", height: 10, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: C.mpBlue, transition: "width 0.4s ease" }} />
    </div>
  );
}

export function StatBox({ char, hp, mp, status }) {
  return (
    <div style={{
      background: C.panel, border: `2px solid ${C.border}`, borderRadius: 4,
      padding: "10px 14px", minWidth: 200, fontFamily: PIXEL_FONT,
    }}>
      <div style={{ fontSize: 10, color: C.bright, marginBottom: 6, letterSpacing: 1 }}>
        {char.name}
        {status && <span style={{ color: status === STATUS.WEAKENED ? C.orange : C.yellow, marginLeft: 6, fontSize: 8 }}>[{status}]</span>}
      </div>
      <div style={{ fontSize: 8, color: C.muted, marginBottom: 3 }}>HP {hp}/{char.maxHp}</div>
      <HPBar current={hp} max={char.maxHp} />
      <div style={{ fontSize: 8, color: C.muted, marginBottom: 3, marginTop: 6 }}>MP {mp}/{char.maxMp}</div>
      <MPBar current={mp} max={char.maxMp} />
    </div>
  );
}
