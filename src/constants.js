import gameJson from "../content/game.json" with { type: "json" };

export const PIXEL_FONT = `"Press Start 2P", monospace`;

export const C = {
  bg: "#0a0e14", panel: "#111820", border: "#2a3a4a",
  bright: "#00ff88", dim: "#1a6644", red: "#ff4444",
  orange: "#ff8844", yellow: "#ffcc00", cyan: "#44ccff",
  white: "#e0e8f0", muted: "#556677",
  hpGreen: "#00cc66", hpRed: "#cc2222", mpBlue: "#3388ee",
};

export const STATUS = {
  STUNNED: "STUNNED",
  WEAKENED: "WEAKENED",
  DEF_PLUS: "DEF+",
  SLOWED: "SLOWED",
};

export const TIMINGS = {
  turnDelay: 1200,
  stunDelay: 800,
  shakeAnim: 400,
  flashAnim: 300,
  blinkInterval: 600,
};

export const GAME = gameJson;

export { rand, pick } from "./game/rng.js";
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
