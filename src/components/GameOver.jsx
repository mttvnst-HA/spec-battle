import { C, PIXEL_FONT } from "../constants.js";
import { ENGINEER_PIXELS, CONTRACTOR_PIXELS } from "../data/sprites.js";
import { PixelSprite } from "./PixelSprite.jsx";

export function GameOver({ winner, onRestart }) {
  const won = winner === "engineer";
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", fontFamily: PIXEL_FONT, textAlign: "center", gap: 14,
    }}>
      <div style={{ fontSize: 12, color: won ? C.bright : C.red }}>
        {won ? "ENGINEER WINS!" : "CONTRACTOR WINS!"}
      </div>
      <PixelSprite data={won ? ENGINEER_PIXELS : CONTRACTOR_PIXELS} size={6} shake={0} flash={0} />
      <div style={{ fontSize: 7, color: C.muted, maxWidth: 320, lineHeight: 1.8, padding: "0 16px" }}>
        {won
          ? "The spec prevails. All submittals rejected. NCRs filed in triplicate. The partnering charter was a lie."
          : "The contractor drove a truck through that spec gap. Change orders approved. Budget obliterated. The claims consultant buys a boat."}
      </div>
      <div onClick={onRestart} style={{
        fontSize: 8, color: C.cyan, cursor: "pointer", marginTop: 10,
        letterSpacing: 2, padding: "8px 16px", border: `1px solid ${C.cyan}`, borderRadius: 4,
      }}>
        [ REMATCH ]
      </div>
    </div>
  );
}
