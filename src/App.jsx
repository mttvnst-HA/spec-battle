import { useState, useReducer, useEffect, useRef } from "react";

const PIXEL_FONT = `"Press Start 2P", monospace`;
// Font loaded via index.html

const C = {
  bg: "#0a0e14", panel: "#111820", border: "#2a3a4a",
  bright: "#00ff88", dim: "#1a6644", red: "#ff4444",
  orange: "#ff8844", yellow: "#ffcc00", cyan: "#44ccff",
  white: "#e0e8f0", muted: "#556677",
  hpGreen: "#00cc66", hpRed: "#cc2222", mpBlue: "#3388ee",
};

// ---- PIXEL SPRITES ----
const ENGINEER_PIXELS = [
  "___ddd___",
  "__ddddd__",
  "__dBdBd__",
  "__ddddd__",
  "__edfde__",
  "___ddd___",
  "__wwwww__",
  "_wwbwww_",
  "_wwbwww_",
  "_wwbwww_",
  "__kwwk__",
  "__k__k__",
];
const CONTRACTOR_PIXELS = [
  "__yyyyy__",
  "__yyyyy__",
  "_yyyyyyy_",
  "__ooooo__",
  "__oBoBo__",
  "__ooooo__",
  "__eoooe__",
  "___ooo___",
  "__OOOOO__",
  "_OOSOOOO_",
  "_OO_OOO_",
  "__OO_OO__",
  "__k___k__",
  "__k___k__",
];
const PIXEL_COLORS = {
  d: "#e8b87a", e: "#d4a06a", f: "#c4756a", B: "#222222",
  w: "#f0f0f0", b: "#111111", k: "#333344", y: "#f0c820",
  o: "#e8b87a", O: "#dd7722", S: "#cccc00", _: "transparent",
};

function PixelSprite({ data, size = 5, shake, flash, flipX }) {
  const prevShake = useRef(shake);
  const prevFlash = useRef(flash);
  const [anim, setAnim] = useState("");
  useEffect(() => {
    if (shake !== prevShake.current) { prevShake.current = shake; setAnim("shake"); setTimeout(() => setAnim(""), 400); }
  }, [shake]);
  useEffect(() => {
    if (flash !== prevFlash.current) { prevFlash.current = flash; setAnim("flash"); setTimeout(() => setAnim(""), 300); }
  }, [flash]);
  const rows = data.length;
  const cols = Math.max(...data.map(r => r.length));
  return (
    <div style={{
      filter: anim === "flash" ? "brightness(3)" : "none",
      animation: anim === "shake" ? "rpg-shake 0.1s 3" : "rpg-idle 1.5s ease-in-out infinite",
      transform: flipX ? "scaleX(-1)" : "none", imageRendering: "pixelated",
    }}>
      <svg width={cols * size} height={rows * size} viewBox={`0 0 ${cols * size} ${rows * size}`} xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
        {data.map((row, ry) => [...row].map((ch, cx) => {
          const color = PIXEL_COLORS[ch];
          if (!color || color === "transparent") return null;
          return <rect key={`${ry}-${cx}`} x={cx * size} y={ry * size} width={size} height={size} fill={color} />;
        }))}
      </svg>
    </div>
  );
}

// ---- GAME DATA: MOVES WITH CONTEXT-SENSITIVE QUOTES ----

const ENGINEER = {
  name: "ENGINEER", maxHp: 140, maxMp: 70,
  moves: [
    {
      name: "REJECT SUBMITTAL", emoji: "🚫", desc: "Code E - Disapproved", dmg: [16, 24], mp: 0, effect: null,
      quotes: [
        "This does not conform to the approved submittal.",
        "Disapproved. See red-lines attached.",
        "This is the third resubmittal. Still non-compliant.",
        "Did you even read the review comments?",
        "Revise and resubmit. Again.",
        "The cut sheet you submitted is for a different product.",
      ],
    },
    {
      name: "RED-LINE SPEC", emoji: "🖊️", desc: "Mark up the submittal in blood red", dmg: [28, 40], mp: 15, effect: null,
      quotes: [
        "See the red-lines attached. All 47 of them.",
        "I highlighted the non-conforming items. In red. The entire page is red.",
        "Remove and replace at no additional cost to the Government.",
        "Per the contract documents, this is unacceptable.",
        "The spec is clear and unambiguous on this point.",
        "As noted in our previous correspondence...",
      ],
    },
    {
      name: "INVOKE SHALL", emoji: "⚖️", desc: "SHALL is mandatory, not optional", dmg: [32, 48], mp: 20, effect: "stun",
      quotes: [
        "The specification says SHALL. Not should. Not may. SHALL.",
        "SHALL is a mandatory obligation. There is no wiggle room.",
        "The contractor bid this work. The time for questioning the spec was during bidding.",
        "Shall means shall. I don't know how to make that clearer.",
        "This is contract compliance, not a suggestion box.",
      ],
    },
    {
      name: "ISSUE NCR", emoji: "📋", desc: "Non-Conformance Report - permanent record", dmg: [18, 28], mp: 12, effect: "weaken",
      quotes: [
        "Noted. Non-conformance report filed.",
        "This NCR will be part of the permanent project record.",
        "Your QC system has failed to prevent this deficiency.",
        "The NCR is tagged and photographed. Enjoy your CPARS.",
        "We look forward to the Contractor's corrective action plan.",
        "This is the fourth NCR this month. See the trend?",
      ],
    },
    {
      name: "CITE UFC", emoji: "📖", desc: "Unified Facilities Criteria - divine authority", dmg: [10, 16], mp: 10, effect: "defense",
      quotes: [
        "Per UFC 1-200-01, this is mandatory for all DoD construction.",
        "The UFC is not optional. It is not a guideline. It is the standard.",
        "We're not building a piano. We're building a military facility to UFC standards.",
        "The Government did not specify the minimum. The Government specified the standard.",
        "Approval does not relieve the contractor from complying with all contract requirements.",
      ],
    },
    {
      name: "CURE NOTICE", emoji: "⏰", desc: "10-day countdown or face termination", dmg: [38, 55], mp: 28, effect: "stun",
      quotes: [
        "You have 10 days to cure this deficiency or face default termination.",
        "Show cause why this contract should not be terminated for default.",
        "Failure to present an explanation may be taken as admission that none exists.",
        "This matter is referred to the Contracting Officer for final decision.",
        "Please be advised...",
      ],
    },
  ],
};

const CONTRACTOR = {
  name: "CONTRACTOR", maxHp: 150, maxMp: 60,
  moves: [
    {
      name: "SUBMIT RFI", emoji: "📝", desc: "Request for Information - paper trail bomb", dmg: [14, 22], mp: 0, effect: null,
      quotes: [
        "The specifications appear to conflict between Section 3.2 and Drawing C-401...",
        "Please clarify the design intent regarding...",
        "Failure to respond within 10 days will impact the critical path.",
        "We have submitted 47 RFIs this week. Your response is overdue on 38 of them.",
        "The answer may be in the documents, but we'd like it in writing from you.",
        "This RFI is submitted without prejudice to the Contractor's right to claim delay.",
      ],
    },
    {
      name: "CLAIM DSC", emoji: "🪨", desc: "Differing Site Conditions - FAR 52.236-2", dmg: [30, 44], mp: 15, effect: null,
      quotes: [
        "Pursuant to FAR 52.236-2, we are providing prompt written notice...",
        "The boring logs did not indicate this condition.",
        "This rock was not reasonably foreseeable from the contract documents.",
        "We consider this a Type I Differing Site Condition.",
        "We stopped work immediately and preserved the evidence. Our photographer was here before the dust settled.",
      ],
    },
    {
      name: "VALUE ENGINEER", emoji: "💰", desc: "Propose cheaper alternative, pocket the split", dmg: [0, 0], mp: 15, effect: "heal",
      quotes: [
        "We've identified significant savings through an alternative approach...",
        "This VECP maintains performance while reducing cost by 40%.",
        "Under FAR 52.248-3, the contractor retains 55% of net savings.",
        "We bid the expensive product. Now here's a cheaper one. You're welcome.",
        "It meets the MINIMUM requirements. That's what minimum means.",
      ],
    },
    {
      name: "SCHEDULE DELAY", emoji: "⏳", desc: "Float manipulation and critical path warfare", dmg: [20, 32], mp: 10, effect: "slow",
      quotes: [
        "The updated CPM shows 47 government-caused delays on the critical path.",
        "Your RFI response consumed the remaining float on Activity 340.",
        "We cannot determine at this time the full effect on the completion date...",
        "Month 1: on schedule. Month 6: the schedule narrative reads like a legal brief.",
        "Who owns the float? We do. Obviously.",
        "Blame weather, supply chain, the tides, and your RFI response time.",
      ],
    },
    {
      name: "OR-EQUAL GAMBIT", emoji: "🔄", desc: "Submit cheap substitute, pocket the difference", dmg: [18, 30], mp: 12, effect: null,
      quotes: [
        "We believe this product is an approved equal per Section 01 60 00.",
        "Other engineers have let us substitute this on every other project.",
        "The base approved this for Building 101 - why not here?",
        "It meets intent. Close enough.",
        "Our sub says it meets spec. Their rep confirmed it. Verbally. Probably.",
        "Nobody installs the specified product anymore. It's obsolete.",
      ],
    },
    {
      name: "RESERVE RIGHTS", emoji: "🛡️", desc: "Defensive posture - preserve future claims", dmg: [8, 14], mp: 8, effect: "defense",
      quotes: [
        "We reserve all rights under the contract.",
        "This work is performed under protest and with full reservation of rights.",
        "We consider this direction to be a constructive change.",
        "Please confirm this direction in writing from the Contracting Officer.",
        "Only the Contracting Officer can bind the Government. You're the COR.",
        "Have you been keeping daily logs? Good. They're evidence now.",
      ],
    },
  ],
};

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- REDUCER ----
const initState = () => ({
  engHp: ENGINEER.maxHp, engMp: ENGINEER.maxMp,
  conHp: CONTRACTOR.maxHp, conMp: CONTRACTOR.maxMp,
  engStatus: null, conStatus: null,
  log: [{ text: "A wild CONTRACTOR appeared on the jobsite!", color: C.yellow },
        { text: '  "We\'re here in a spirit of partnering and collaboration."', color: C.white }],
  turn: "player", busy: false,
  engShake: 0, conShake: 0, engFlash: 0, conFlash: 0,
  winner: null,
});

function resolveMove(state, attacker, move, isPlayer) {
  let s = { ...state };
  const quote = pick(move.quotes);
  let newLog = [
    { text: `${attacker.name} uses ${move.emoji} ${move.name}!`, color: C.bright },
    { text: `  "${quote}"`, color: C.white },
  ];

  if (isPlayer) { s.engMp = Math.max(0, s.engMp - move.mp); s.engFlash += 1; }
  else { s.conMp = Math.max(0, s.conMp - move.mp); s.conFlash += 1; }

  // Heal
  if (move.effect === "heal") {
    const heal = rand(28, 45);
    if (isPlayer) s.engHp = clamp(s.engHp + heal, 0, ENGINEER.maxHp);
    else s.conHp = clamp(s.conHp + heal, 0, CONTRACTOR.maxHp);
    newLog.push({ text: `  Recovered ${heal} HP!`, color: C.hpGreen });
    s.log = [...s.log, ...newLog];
    return s;
  }

  // Defense buff
  if (move.effect === "defense") {
    if (isPlayer) s.engStatus = "DEF+"; else s.conStatus = "DEF+";
    newLog.push({ text: `  Defense raised!`, color: C.cyan });
  }

  // Weaken debuff (NCR lowers opponent defense)
  if (move.effect === "weaken") {
    if (isPlayer) s.conStatus = "WEAKENED"; else s.engStatus = "WEAKENED";
    newLog.push({ text: `  Target's defense lowered!`, color: C.orange });
  }

  // Damage calc
  let dmg = rand(move.dmg[0], move.dmg[1]);
  const crit = Math.random() < 0.12;
  if (crit) dmg = Math.floor(dmg * 1.6);
  const defStatus = isPlayer ? s.conStatus : s.engStatus;
  if (defStatus === "DEF+") dmg = Math.floor(dmg * 0.5);
  const atkStatus = isPlayer ? s.engStatus : s.conStatus;
  // Weakened target takes more damage (applied to defender)
  if ((isPlayer ? s.conStatus : s.engStatus) === "WEAKENED" && move.effect !== "weaken") {
    dmg = Math.floor(dmg * 1.3);
  }

  if (isPlayer) { s.conHp = Math.max(0, s.conHp - dmg); s.conShake += 1; }
  else { s.engHp = Math.max(0, s.engHp - dmg); s.engShake += 1; }
  newLog.push({ text: `  ${crit ? "CRITICAL HIT! " : ""}${dmg} damage!`, color: crit ? C.yellow : C.red });

  // Stun
  if (move.effect === "stun" && Math.random() < 0.3) {
    if (isPlayer) s.conStatus = "STUNNED"; else s.engStatus = "STUNNED";
    newLog.push({ text: `  Target is STUNNED!`, color: C.yellow });
  }
  // Slow
  if (move.effect === "slow" && Math.random() < 0.4) {
    if (isPlayer) s.conStatus = "SLOWED"; else s.engStatus = "SLOWED";
    newLog.push({ text: `  Target is SLOWED!`, color: C.orange });
  }

  s.log = [...s.log, ...newLog];
  return s;
}

function pickAIMove(state) {
  // Heal if low
  if (state.conHp < 50 && state.conMp >= 15) return CONTRACTOR.moves[2]; // VALUE ENGINEER
  // Use Reserve Rights if weakened
  if (state.conStatus === "WEAKENED" && state.conMp >= 8) return CONTRACTOR.moves[5];
  // Favor big attacks if engineer is low
  if (state.engHp < 40 && state.conMp >= 15) return CONTRACTOR.moves[1]; // CLAIM DSC
  // Weighted random from available
  const avail = CONTRACTOR.moves.filter(m => m.mp <= state.conMp && m.effect !== "heal");
  if (avail.length === 0) return CONTRACTOR.moves[0]; // fallback to RFI
  // Weight toward variety
  return pick(avail);
}

function reducer(state, action) {
  switch (action.type) {
    case "PLAYER_MOVE": {
      const move = action.move;
      if (state.turn !== "player" || state.busy) return state;
      if (move.mp > state.engMp) {
        return { ...state, log: [...state.log, { text: "Not enough MP!", color: C.red }] };
      }
      if (state.engStatus === "STUNNED") {
        return {
          ...state, engStatus: null, turn: "enemy", busy: true,
          log: [...state.log, { text: "ENGINEER is stunned! Turn skipped!", color: C.yellow }],
        };
      }
      let s = resolveMove(state, ENGINEER, move, true);
      s.conMp = clamp(s.conMp + 4, 0, CONTRACTOR.maxMp);
      if (s.conStatus === "DEF+") s.conStatus = null;
      if (s.conHp <= 0) return { ...s, busy: true, winner: "engineer" };
      return { ...s, turn: "enemy", busy: true };
    }
    case "ENEMY_MOVE": {
      if (state.turn !== "enemy") return state;
      if (state.conStatus === "STUNNED") {
        return {
          ...state, conStatus: null, turn: "player", busy: false,
          log: [...state.log, { text: "CONTRACTOR is stunned! Turn skipped!", color: C.yellow }],
        };
      }
      const move = pickAIMove(state);
      let s = resolveMove(state, CONTRACTOR, move, false);
      s.engMp = clamp(s.engMp + 4, 0, ENGINEER.maxMp);
      if (s.engStatus === "DEF+") s.engStatus = null;
      if (s.engHp <= 0) return { ...s, busy: true, winner: "contractor" };
      return { ...s, turn: "player", busy: false };
    }
    case "RESET": return initState();
    default: return state;
  }
}

// ---- UI COMPONENTS ----
function HPBar({ current, max }) {
  const pct = Math.max(0, (current / max) * 100);
  return (
    <div style={{ width: "100%", height: 10, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
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
    <div style={{ width: "100%", height: 6, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: C.mpBlue, transition: "width 0.4s ease" }} />
    </div>
  );
}

function StatBox({ char, hp, mp, status }) {
  return (
    <div style={{
      background: C.panel, border: `2px solid ${C.border}`, borderRadius: 4,
      padding: "8px 10px", minWidth: 150, fontFamily: PIXEL_FONT,
    }}>
      <div style={{ fontSize: 7, color: C.bright, marginBottom: 4, letterSpacing: 1 }}>
        {char.name}
        {status && <span style={{ color: status === "WEAKENED" ? C.orange : C.yellow, marginLeft: 4, fontSize: 6 }}>[{status}]</span>}
      </div>
      <div style={{ fontSize: 6, color: C.muted, marginBottom: 2 }}>HP {hp}/{char.maxHp}</div>
      <HPBar current={hp} max={char.maxHp} />
      <div style={{ fontSize: 6, color: C.muted, marginBottom: 2, marginTop: 4 }}>MP {mp}/{char.maxMp}</div>
      <MPBar current={mp} max={char.maxMp} />
    </div>
  );
}

function LogBox({ log }) {
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

// ---- SCREENS ----
function TitleScreen({ onStart }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { const t = setInterval(() => setBlink(b => !b), 600); return () => clearInterval(t); }, []);
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", fontFamily: PIXEL_FONT, textAlign: "center", gap: 14,
    }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2 }}>NAVFAC PRESENTS</div>
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

function GameOver({ winner, onRestart }) {
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

// ---- BATTLE SCREEN ----
function BattleScreen({ onEnd }) {
  const [state, dispatch] = useReducer(reducer, null, initState);

  useEffect(() => {
    if (state.turn === "enemy" && state.busy && !state.winner) {
      const t = setTimeout(() => dispatch({ type: "ENEMY_MOVE" }), 1200);
      return () => clearTimeout(t);
    }
  }, [state.turn, state.busy, state.winner]);

  useEffect(() => {
    if (state.winner) {
      const t = setTimeout(() => onEnd(state.winner), 1200);
      return () => clearTimeout(t);
    }
  }, [state.winner, onEnd]);

  const canAct = state.turn === "player" && !state.busy && !state.winner;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 4, padding: "4px 0" }}>
      {/* Battlefield */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "4px 8px", gap: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <StatBox char={ENGINEER} hp={state.engHp} mp={state.engMp} status={state.engStatus} />
          <PixelSprite data={ENGINEER_PIXELS} size={4} shake={state.engShake} flash={state.engFlash} />
        </div>
        <div style={{ fontFamily: PIXEL_FONT, fontSize: 9, color: C.yellow, animation: "rpg-pulse 2s ease-in-out infinite", paddingTop: 30 }}>VS</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <StatBox char={CONTRACTOR} hp={state.conHp} mp={state.conMp} status={state.conStatus} />
          <PixelSprite data={CONTRACTOR_PIXELS} size={4} shake={state.conShake} flash={state.conFlash} flipX />
        </div>
      </div>

      {/* Turn indicator */}
      <div style={{
        fontFamily: PIXEL_FONT, fontSize: 6, textAlign: "center",
        color: state.turn === "player" ? C.bright : C.orange, letterSpacing: 1, padding: "2px 0",
      }}>
        {state.winner ? "" : state.turn === "player" ? ">> YOUR TURN <<" : "... CONTRACTOR is reviewing the contract ..."}
      </div>

      {/* Log */}
      <div style={{ flex: "1 1 0", minHeight: 0, padding: "0 6px", display: "flex", flexDirection: "column" }}>
        <LogBox log={state.log} />
      </div>

      {/* Move buttons - 3x2 grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, padding: "2px 6px 4px 6px" }}>
        {ENGINEER.moves.map((m, i) => {
          const usable = canAct && m.mp <= state.engMp;
          return (
            <div
              key={i}
              onClick={() => usable && dispatch({ type: "PLAYER_MOVE", move: m })}
              style={{
                fontFamily: PIXEL_FONT, fontSize: 6, padding: "6px 4px",
                background: usable ? C.panel : "#0d1117",
                border: `2px solid ${usable ? C.bright : C.border}`,
                borderRadius: 4, cursor: usable ? "pointer" : "default",
                color: usable ? C.white : C.muted,
                textAlign: "center", lineHeight: 1.5,
                opacity: usable ? 1 : 0.4,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { if (usable) e.currentTarget.style.background = C.dim; }}
              onMouseLeave={e => { e.currentTarget.style.background = usable ? C.panel : "#0d1117"; }}
            >
              <div>{m.emoji} {m.name}</div>
              {m.mp > 0 && <div style={{ color: C.mpBlue, fontSize: 6 }}>({m.mp} MP)</div>}
              <div style={{ fontSize: 5, color: C.muted, marginTop: 2 }}>{m.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- APP ROOT ----
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
