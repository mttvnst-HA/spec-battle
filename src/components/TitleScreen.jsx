import { useState, useEffect } from "react";
import { C, PIXEL_FONT, TIMINGS } from "../constants.js";
import { ENGINEER_PIXELS, CONTRACTOR_PIXELS } from "../data/sprites.js";
import { PixelSprite } from "./PixelSprite.jsx";

export function TitleScreen({ onStart }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { const t = setInterval(() => setBlink(b => !b), TIMINGS.blinkInterval); return () => clearInterval(t); }, []);
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", fontFamily: PIXEL_FONT, textAlign: "center", gap: 14,
    }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2 }}>SpecWriter PRESENTS</div>
      <div style={{ fontSize: 22, color: C.bright, lineHeight: 1.4, textShadow: `0 0 20px ${C.dim}` }}>
        SPEC<br/>BATTLE
      </div>
      <div style={{ display: "flex", gap: 28, alignItems: "flex-end", margin: "6px 0" }}>
        <PixelSprite data={ENGINEER_PIXELS} size={5} shake={0} flash={0} />
        <div style={{ fontSize: 16, color: C.yellow, fontFamily: PIXEL_FONT, marginBottom: 8 }}>VS</div>
        <PixelSprite data={CONTRACTOR_PIXELS} size={5} shake={0} flash={0} />
      </div>
      <div style={{ fontSize: 7, color: C.cyan, letterSpacing: 1 }}>ENGINEER vs CONTRACTOR</div>
      <div style={{ fontSize: 6, color: C.muted, maxWidth: 320, lineHeight: 1.8, padding: "0 20px" }}>
        A conflict where both sides wield the same contract against each other, each convinced the other is acting in bad faith.
      </div>
      <div onClick={onStart} style={{
        fontSize: 8, color: blink ? C.bright : "transparent", marginTop: 8,
        cursor: "pointer", letterSpacing: 2, padding: "10px 20px",
      }}>
        [ PRESS TO START ]
      </div>
    </div>
  );
}
