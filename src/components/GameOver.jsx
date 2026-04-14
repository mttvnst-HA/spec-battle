import { useRef } from "react";
import { C, PIXEL_FONT, pick } from "../constants.js";
import { ENGINEER_PIXELS, CONTRACTOR_PIXELS } from "../data/sprites.js";
import { PixelSprite } from "./PixelSprite.jsx";

const ENGINEER_WINS_TEXT = [
  "The spec prevails. All submittals rejected. NCRs filed in triplicate. The partnering charter was a lie.",
  "Default termination issued. The contractor's future bidding capability is devastated for years. The auditors go in after the war is lost and bayonet the wounded.",
  "The punch list ran to 47 pages. Retainage was held until the last ceiling tile was aligned. The partnering charter was never spoken of again.",
  "This matter has been referred to the Contracting Officer for final decision. The final decision was: default termination.",
];

const CONTRACTOR_WINS_TEXT = [
  "The contractor drove a truck through that spec gap. Change orders approved. Budget obliterated. The claims consultant buys a boat.",
  "The claims consultant arrived like a vulture circling a dying animal. 200-page entitlement analysis. $4.2 million equitable adjustment. The daily logs were evidence now.",
  "4,000 RFIs. 47 government-caused delays on the critical path. The schedule narrative reads like a legal brief and the court agreed with every word.",
  "Termination for Convenience -- actually favorable to the contractor. The government's nuclear option converted into a golden parachute.",
];

export function GameOver({ winner, onRestart }) {
  const won = winner === "engineer";
  const textRef = useRef(null);
  if (!textRef.current) textRef.current = pick(won ? ENGINEER_WINS_TEXT : CONTRACTOR_WINS_TEXT);

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
