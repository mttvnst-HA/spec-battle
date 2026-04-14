import { useEffect, useRef } from "react";
import { C, PIXEL_FONT } from "../constants.js";

export function LogBox({ log }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
  return (
    <div ref={ref} style={{
      background: C.bg, border: `2px solid ${C.border}`, borderRadius: 4,
      padding: 8, flex: "1 1 0", overflowY: "auto", fontFamily: PIXEL_FONT,
      fontSize: 7, color: C.white, lineHeight: 2.4,
    }}>
      {log.map((l, i) => <div key={i} style={{ color: l.color || C.white, marginBottom: 3 }}>{l.text}</div>)}
    </div>
  );
}
