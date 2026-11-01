import { describe, it, expect, vi } from "vitest";
import { makeGit } from "../tune/gitOps.js";

function recorder() {
  const calls = [];
  const exec = vi.fn((file, args) => { calls.push({ file, args }); return ""; });
  return { calls, exec };
}

describe("makeGit", () => {
  it("commitAll runs 'git add -- content/' then 'git commit -m <msg>' via injected exec", () => {
    const { calls, exec } = recorder();
    const git = makeGit({ exec });

    git.commitAll("tune(iter-1): nerf REJECT SUBMITTAL dmg");

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ file: "git", args: ["add", "--", "content/"] });
    expect(calls[1]).toEqual({
      file: "git",
      args: ["commit", "-m", "tune(iter-1): nerf REJECT SUBMITTAL dmg"],
    });
  });

  it("does NOT use 'git add -A' (which would sweep up stray logfiles, scratch, etc.)", () => {
    // Guardrail against regression. Observed 2026-04-15: a tune:llm run
    // piped through `tee tune-run.log` landed that logfile inside several
    // iter-N commits because `git add -A` captured everything. Scoping to
    // `content/` is the only thing the tune proposer mutates.
    const { calls, exec } = recorder();
    const git = makeGit({ exec });

    git.commitAll("tune(iter-1): anything");

    expect(calls[0].args).not.toContain("-A");
    expect(calls[0].args).not.toContain("--all");
    expect(calls[0].args).not.toContain(".");
  });

  it("passes the message as a single argv entry, untouched (no shell, no escaping)", () => {
    // The message comes from LLM output. With an argv array there is no
    // shell to interpret quotes, backticks, $(...), &, | or % — on bash or
    // cmd.exe — so the text must reach git byte-for-byte.
    const { calls, exec } = recorder();
    const git = makeGit({ exec });
    const hostile = `tune: "X" & del /q * | \`whoami\` $(id) %PATH%\nline2`;

    git.commitAll(hostile);

    expect(calls[1].args).toHaveLength(3);
    expect(calls[1].args[2]).toBe(hostile);
  });

  it("keeps a message starting with '-' as the -m value rather than a flag", () => {
    const { calls, exec } = recorder();
    const git = makeGit({ exec });

    git.commitAll("--amend");

    expect(calls[1].args).toEqual(["commit", "-m", "--amend"]);
  });

  it("rejects an empty or non-string message before touching git", () => {
    const { calls, exec } = recorder();
    const git = makeGit({ exec });

    expect(() => git.commitAll("")).toThrow(TypeError);
    expect(() => git.commitAll("   ")).toThrow(TypeError);
    expect(() => git.commitAll(undefined)).toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("propagates exec errors", () => {
    const exec = () => { throw new Error("git: command not found"); };
    const git = makeGit({ exec });
    expect(() => git.commitAll("whatever")).toThrow(/git: command not found/);
  });
});
