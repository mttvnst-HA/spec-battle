import { useRef } from "react";
import { C, PIXEL_FONT, pick } from "../constants.js";
import { ENGINEER_PIXELS, CONTRACTOR_PIXELS } from "../data/sprites.js";
import { GAME_OVER_TEXT } from "../data/content-loader.js";
import { PixelSprite } from "./PixelSprite.jsx";

export function GameOver({ winner, onRestart }) {
  const won = winner === "engineer";
  const textRef = useRef(null);
  if (!textRef.current) textRef.current = pick(won ? GAME_OVER_TEXT.engineer : GAME_OVER_TEXT.contractor);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", fontFamily: PIXEL_FONT, textAlign: "center", gap: 18,
    }}>
      <div style={{ fontSize: 18, color: won ? C.bright : C.red }}>
        {won ? "ENGINEER WINS!" : "CONTRACTOR WINS!"}
      </div>
      <PixelSprite data={won ? ENGINEER_PIXELS : CONTRACTOR_PIXELS} size={8} shake={0} flash={0} />
      <div style={{ fontSize: 11, color: C.white, maxWidth: 440, lineHeight: 1.8, padding: "0 20px" }}>
        {textRef.current}
      </div>
      <div onClick={onRestart} style={{
        fontSize: 11, color: C.cyan, cursor: "pointer", marginTop: 12,
        letterSpacing: 2, padding: "10px 20px", border: `1px solid ${C.cyan}`, borderRadius: 4,
      }}>
        [ REMATCH ]
      </div>
    </div>
  );
}
