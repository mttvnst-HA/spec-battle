import { describe, it, expect, vi } from "vitest";
import { createCliTransport } from "../tune/claudeTransport.js";

describe("createCliTransport", () => {
  it("send(prompt) forwards prompt, model, timeoutMs, and executable to the injected exec", () => {
    const exec = vi.fn(() => '{"type":"result","result":"ok"}');
    const t = createCliTransport({ exec, model: "claude-opus-4-6", timeoutMs: 1000 });
    const out = t.send("hello");
    expect(out).toBe('{"type":"result","result":"ok"}');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith({
      prompt: "hello",
      model: "claude-opus-4-6",
      timeoutMs: 1000,
      executable: "claude",
    });
  });

  it("uses claude-sonnet-4-6, 240s timeout, and 'claude' executable by default", () => {
    const exec = vi.fn(() => "stdout");
    const t = createCliTransport({ exec });
    t.send("hi");
    expect(exec).toHaveBeenCalledWith({
      prompt: "hi",
      model: "claude-sonnet-4-6",
      timeoutMs: 240_000,
      executable: "claude",
    });
  });

  it("honors an explicit executable option (absolute path)", () => {
    const exec = vi.fn(() => "stdout");
    const t = createCliTransport({ exec, executable: "/c/Users/me/AppData/Roaming/Claude/claude-code/2.1.101/claude.exe" });
    t.send("hi");
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({
      executable: "/c/Users/me/AppData/Roaming/Claude/claude-code/2.1.101/claude.exe",
    }));
  });

  it("throws if prompt is empty or not a string", () => {
    const exec = vi.fn();
    const t = createCliTransport({ exec });
    expect(() => t.send("")).toThrow(/non-empty string/);
    expect(() => t.send(null)).toThrow(/non-empty string/);
    expect(() => t.send(undefined)).toThrow(/non-empty string/);
    expect(() => t.send(42)).toThrow(/non-empty string/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("propagates exec errors (nonzero exit)", () => {
    const exec = vi.fn(() => { const e = new Error("Command failed"); e.status = 1; throw e; });
    const t = createCliTransport({ exec });
    expect(() => t.send("prompt")).toThrow(/Command failed/);
  });

  it("propagates timeout errors (SIGTERM)", () => {
    // Signal-only SIGTERM (no .code === 'ETIMEDOUT') is NOT a confirmed
    // timeout — might be an external kill. Deliberately does not retry.
    const exec = vi.fn(() => { const e = new Error("ETIMEDOUT"); e.signal = "SIGTERM"; throw e; });
    const t = createCliTransport({ exec });
    expect(() => t.send("prompt")).toThrow(/ETIMEDOUT/);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("retries once on ETIMEDOUT and returns stdout from the 2nd call", () => {
    let callCount = 0;
    const exec = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        const e = new Error("spawnSync claude.exe ETIMEDOUT");
        e.code = "ETIMEDOUT";
        e.signal = "SIGTERM";
        throw e;
      }
      return '{"type":"result","result":"ok"}';
    });
    const t = createCliTransport({ exec });
    expect(t.send("prompt")).toBe('{"type":"result","result":"ok"}');
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("re-throws with '(after 1 retry)' suffix when both calls time out", () => {
    const exec = vi.fn(() => {
      const e = new Error("spawnSync claude.exe ETIMEDOUT");
      e.code = "ETIMEDOUT";
      e.signal = "SIGTERM";
      throw e;
    });
    const t = createCliTransport({ exec });
    let caught;
    try { t.send("prompt"); } catch (err) { caught = err; }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/ETIMEDOUT/);
    expect(caught.message).toMatch(/after 1 retry/);
    expect(caught.code).toBe("ETIMEDOUT");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-ETIMEDOUT errors (nonzero exit)", () => {
    const exec = vi.fn(() => {
      const e = new Error("Command failed");
      e.status = 1;
      throw e;
    });
    const t = createCliTransport({ exec });
    expect(() => t.send("prompt")).toThrow(/Command failed/);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
