import { useState } from "react";
import { C } from "./constants.js";
import { TitleScreen } from "./components/TitleScreen.jsx";
import { BattleScreen } from "./components/BattleScreen.jsx";
import { GameOver } from "./components/GameOver.jsx";

export default function SpecBattleRPG() {
  const [screen, setScreen] = useState("title");
  const [winner, setWinner] = useState(null);

  return (
    <>
      <style>{`
        @keyframes rpg-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
        @keyframes rpg-idle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes rpg-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
      <div style={{
        background: C.bg, width: "100%", height: "100vh", maxWidth: 540, margin: "0 auto",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10,
          background: "repeating-linear-gradient(0deg, rgba(0,255,136,0.03) 0px, rgba(0,255,136,0.03) 1px, transparent 1px, transparent 3px)",
        }} />
        {screen === "title" && <TitleScreen onStart={() => setScreen("battle")} />}
        {screen === "battle" && <BattleScreen onEnd={(w) => { setWinner(w); setScreen("gameover"); }} />}
        {screen === "gameover" && <GameOver winner={winner} onRestart={() => { setWinner(null); setScreen("title"); }} />}
      </div>
    </>
  );
}
