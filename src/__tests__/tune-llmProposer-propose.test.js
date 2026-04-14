import { describe, it, expect, vi } from "vitest";
import { createLlmProposer } from "../tune/llmProposer.js";

const state = {
  GAME: { critRate: 0.12, critMultiplier: 1.6, mpRegen: 4, healRange: [28, 45], weakenedMultiplier: 1.3 },
  moves: {
    engineer: [{ name: "REJECT SUBMITTAL", dmg: [16, 24], mp: 10 }],
    contractor: [{ name: "CLAIM DSC", dmg: [18, 28], mp: 12 }],
  },
};
const report = {
  matchups: [
    { matchup: "random-vs-random", engineerWinRate: 0.865, avgTurns: 12.5,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.4 }, contractor: { "CLAIM DSC": 0.35 } } },
    { matchup: "random-vs-ai", engineerWinRate: 0.715, avgTurns: 18.7,
      moveFrequency: { engineer: { "REJECT SUBMITTAL": 0.3 }, contractor: { "CLAIM DSC": 0.5 } } },
  ],
};
const validBundle = {
  rule: "llm-test",
  summary: "tweak critRate down",
  targets: [{ target: "GAME.critRate", before: 0.12, after: 0.10 }],
};
const envelope = (inner) => JSON.stringify({ type: "result", subtype: "success", result: inner });

describe("createLlmProposer.propose", () => {
  it("sends a prompt via transport and returns {ok:true, bundle} on valid response", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const r = proposer.propose(report, 0, []);
    expect(send).toHaveBeenCalledTimes(1);
    const prompt = send.mock.calls[0][0];
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("# Role");
    expect(r).toEqual({ ok: true, bundle: validBundle });
  });

  it("returns {ok:false} when transport returns garbage", () => {
    const send = vi.fn(() => "garbage no json");
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const r = proposer.propose(report, 0, []);
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("returns null when transport throws (non-recoverable)", () => {
    const send = vi.fn(() => { throw new Error("ENOENT: claude not found"); });
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const r = proposer.propose(report, 0, []);
    expect(r).toBeNull();
  });

  it("threads retryError into the prompt when opts.retryError is provided", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    proposer.propose(report, 0, [], { retryError: "targets[0].before mismatch" });
    const prompt = send.mock.calls[0][0];
    expect(prompt).toContain("# Retry context");
    expect(prompt).toContain("targets[0].before mismatch");
  });

  it("omits retry section when opts.retryError is absent", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    proposer.propose(report, 0, []);
    const prompt = send.mock.calls[0][0];
    expect(prompt).not.toContain("# Retry context");
  });

  it("passes history to buildPrompt (recent entries appear in prompt)", () => {
    const send = vi.fn(() => envelope(JSON.stringify(validBundle)));
    const proposer = createLlmProposer({ transport: { send }, getCurrentState: () => state });
    const history = [
      { iteration: 1, bundle: { rule: "prior", summary: "x", targets: [] },
        outcome: "accepted", report, worstDistanceBefore: 0.365, worstDistanceAfter: 0.320 },
    ];
    proposer.propose(report, 1, history);
    const prompt = send.mock.calls[0][0];
    expect(prompt).toContain('"iteration": 1');
    expect(prompt).toContain('"worstDistanceAfter": 0.32');
  });
});
