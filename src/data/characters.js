import { GAME } from "../constants.js";

export const ENGINEER = {
  name: "ENGINEER", maxHp: 140, maxMp: 70, mpRegen: GAME.mpRegen,
  moves: [
    {
      name: "REJECT SUBMITTAL", emoji: "\u{1F6AB}", desc: "Code E - Disapproved", dmg: [16, 24], mp: 0, effect: null,
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
      name: "RED-LINE SPEC", emoji: "\u{1F58A}\u{FE0F}", desc: "Mark up the submittal in blood red", dmg: [28, 40], mp: 15, effect: null,
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
      name: "INVOKE SHALL", emoji: "\u{2696}\u{FE0F}", desc: "SHALL is mandatory, not optional", dmg: [32, 48], mp: 20, effect: "stun",
      quotes: [
        "The specification says SHALL. Not should. Not may. SHALL.",
        "SHALL is a mandatory obligation. There is no wiggle room.",
        "The contractor bid this work. The time for questioning the spec was during bidding.",
        "Shall means shall. I don't know how to make that clearer.",
        "This is contract compliance, not a suggestion box.",
      ],
    },
    {
      name: "ISSUE NCR", emoji: "\u{1F4CB}", desc: "Non-Conformance Report - permanent record", dmg: [18, 28], mp: 12, effect: "weaken",
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
      name: "CITE UFC", emoji: "\u{1F4D6}", desc: "Unified Facilities Criteria - divine authority", dmg: [10, 16], mp: 10, effect: "defense",
      quotes: [
        "Per UFC 1-200-01, this is mandatory for all DoD construction.",
        "The UFC is not optional. It is not a guideline. It is the standard.",
        "We're not building a piano. We're building a military facility to UFC standards.",
        "The Government did not specify the minimum. The Government specified the standard.",
        "Approval does not relieve the contractor from complying with all contract requirements.",
      ],
    },
    {
      name: "CURE NOTICE", emoji: "\u{23F0}", desc: "10-day countdown or face termination", dmg: [38, 55], mp: 28, effect: "stun",
      quotes: [
        "You have 10 days to cure this deficiency or face default termination.",
        "Show cause why this contract should not be terminated for default.",
        "Failure to present an explanation may be taken as admission that none exists.",
        "This matter is referred to the Contracting Officer for final decision.",
        "Please be advised...",
      ],
    },
    {
      name: "WALK OFF THREAT", emoji: "\u{1F6AA}\u{1F4B8}", desc: "I could just... leave. I could do that.", dmg: [0, 0], mp: 20, effect: null,
      walkOffOnly: true, dud: true,
      quotes: [
        "You threaten to walk off the project... Nothing happens.",
      ],
    },
  ],
};

export const CONTRACTOR = {
  name: "CONTRACTOR", maxHp: 150, maxMp: 60, mpRegen: GAME.mpRegen,
  moves: [
    {
      name: "SUBMIT RFI", emoji: "\u{1F4DD}", desc: "Request for Information - paper trail bomb", dmg: [14, 22], mp: 0, effect: null,
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
      name: "CLAIM DSC", emoji: "\u{1FAA8}", desc: "Differing Site Conditions - FAR 52.236-2", dmg: [30, 44], mp: 15, effect: null,
      quotes: [
        "Pursuant to FAR 52.236-2, we are providing prompt written notice...",
        "The boring logs did not indicate this condition.",
        "This rock was not reasonably foreseeable from the contract documents.",
        "We consider this a Type I Differing Site Condition.",
        "We stopped work immediately and preserved the evidence. Our photographer was here before the dust settled.",
      ],
    },
    {
      name: "VALUE ENGINEER", emoji: "\u{1F4B0}", desc: "Propose cheaper alternative, pocket the split", dmg: [0, 0], mp: 15, effect: "heal",
      quotes: [
        "We've identified significant savings through an alternative approach...",
        "This VECP maintains performance while reducing cost by 40%.",
        "Under FAR 52.248-3, the contractor retains 55% of net savings.",
        "We bid the expensive product. Now here's a cheaper one. You're welcome.",
        "It meets the MINIMUM requirements. That's what minimum means.",
      ],
    },
    {
      name: "SCHEDULE DELAY", emoji: "\u{23F3}", desc: "Float manipulation and critical path warfare", dmg: [20, 32], mp: 10, effect: "slow",
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
      name: "OR-EQUAL GAMBIT", emoji: "\u{1F504}", desc: "Submit cheap substitute, pocket the difference", dmg: [18, 30], mp: 12, effect: null,
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
      name: "RESERVE RIGHTS", emoji: "\u{1F6E1}\u{FE0F}", desc: "Defensive posture - preserve future claims", dmg: [8, 14], mp: 8, effect: "defense",
      quotes: [
        "We reserve all rights under the contract.",
        "This work is performed under protest and with full reservation of rights.",
        "We consider this direction to be a constructive change.",
        "Please confirm this direction in writing from the Contracting Officer.",
        "Only the Contracting Officer can bind the Government. You're the COR.",
        "Have you been keeping daily logs? Good. They're evidence now.",
      ],
    },
    {
      name: "WALK OFF THREAT", emoji: "\u{1F6AA}\u{1F4B8}", desc: "Demobilize unless you pay more. NOW.", dmg: [45, 68], mp: 20, effect: "stun",
      walkOffOnly: true,
      quotes: [
        "We are halting all operations pending resolution of our outstanding claims.",
        "This project is no longer economically viable for us.",
        "Absent a written change order by close of business Friday, we begin demobilization.",
        "Crews are being reassigned to other projects.",
        "We are ceasing all work effective immediately.",
      ],
    },
  ],
};
