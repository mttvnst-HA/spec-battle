import { useState, useEffect, useRef } from "react";
import { TIMINGS } from "../constants.js";
import { PIXEL_COLORS } from "../data/sprites.js";

export function PixelSprite({ data, size = 5, shake, flash, flipX }) {
  const prevShake = useRef(shake);
  const prevFlash = useRef(flash);
  const [anim, setAnim] = useState("");
  useEffect(() => {
    if (shake !== prevShake.current) { prevShake.current = shake; setAnim("shake"); setTimeout(() => setAnim(""), TIMINGS.shakeAnim); }
  }, [shake]);
  useEffect(() => {
    if (flash !== prevFlash.current) { prevFlash.current = flash; setAnim("flash"); setTimeout(() => setAnim(""), TIMINGS.flashAnim); }
  }, [flash]);
  const rows = data.length;
  const cols = Math.max(...data.map(r => r.length));
  return (
    <div style={{ transform: flipX ? "scaleX(-1)" : "none" }}>
    <div style={{
      filter: anim === "flash" ? "brightness(3)" : "none",
      animation: anim === "shake" ? "rpg-shake 0.1s 3" : "rpg-idle 1.5s ease-in-out infinite",
      imageRendering: "pixelated",
    }}>
      <svg width={cols * size} height={rows * size} viewBox={`0 0 ${cols * size} ${rows * size}`} xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
        {data.map((row, ry) => [...row].map((ch, cx) => {
          const color = PIXEL_COLORS[ch];
          if (!color || color === "transparent") return null;
          return <rect key={`${ry}-${cx}`} x={cx * size} y={ry * size} width={size} height={size} fill={color} />;
        }))}
      </svg>
    </div>
    </div>
  );
}
