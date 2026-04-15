import { useEffect, useRef } from "react";
import { C, PIXEL_FONT } from "../constants.js";
import { ENGINEER_PIXELS, CONTRACTOR_PIXELS } from "../data/sprites.js";
import { PIXEL_COLORS } from "../data/sprites.js";

const SIDE_COLOR = { engineer: C.bright, contractor: C.orange };

function MiniSprite({ data }) {
  const sz = 1.5;
  const rows = data.length;
  const cols = Math.max(...data.map(r => r.length));
  return (
    <svg width={cols * sz} height={rows * sz} viewBox={`0 0 ${cols * sz} ${rows * sz}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4, imageRendering: "pixelated", flexShrink: 0 }}>
      {data.map((row, ry) => [...row].map((ch, cx) => {
        const color = PIXEL_COLORS[ch];
        if (!color || color === "transparent") return null;
        return <rect key={`${ry}-${cx}`} x={cx * sz} y={ry * sz} width={sz} height={sz} fill={color} />;
      }))}
    </svg>
  );
}

const SIDE_SPRITE = { engineer: ENGINEER_PIXELS, contractor: CONTRACTOR_PIXELS };

export function LogBox({ log }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
  return (
    <div ref={ref} style={{
      background: C.bg, border: `2px solid ${C.border}`, borderRadius: 4,
      padding: 8, flex: "1 1 0", overflowY: "auto", fontFamily: PIXEL_FONT,
      fontSize: 8, color: C.white, lineHeight: 1.7,
    }}>
      {log.map((l, i) => {
        const textColor = l.color || (l.side ? SIDE_COLOR[l.side] : C.white);
        const showSprite = l.gap && l.side;
        return (
          <div key={i}>
            {l.gap && i > 0 && <div style={{ borderTop: `1px solid ${C.border}`, margin: "6px 0" }} />}
            <div style={{ color: textColor, marginBottom: 4, display: showSprite ? "flex" : "block", alignItems: "flex-start" }}>
              {showSprite && <MiniSprite data={SIDE_SPRITE[l.side]} />}
              <span>{l.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
