import { describe, it, expect, vi } from "vitest";
import { makeGit } from "../tune/gitOps.js";

describe("makeGit", () => {
  it("commitAll runs 'git add -A' then 'git commit -m <msg>' via injected exec", () => {
    const calls = [];
    const exec = vi.fn((cmd) => { calls.push(cmd); return ""; });
    const git = makeGit({ exec });

    git.commitAll("tune(iter-1): nerf REJECT SUBMITTAL dmg");

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("git add -A");
    expect(calls[1]).toMatch(/^git commit -m /);
    expect(calls[1]).toContain("tune(iter-1): nerf REJECT SUBMITTAL dmg");
  });

  it("escapes double quotes inside the commit message", () => {
    const calls = [];
    const exec = vi.fn((cmd) => { calls.push(cmd); return ""; });
    const git = makeGit({ exec });

    git.commitAll(`tune: change "X" to "Y"`);

    expect(calls[1]).toContain(`\\"X\\"`);
    expect(calls[1]).toContain(`\\"Y\\"`);
  });

  it("escapes shell metacharacters (backticks, $, newlines) to prevent injection", () => {
    const calls = [];
    const exec = vi.fn((cmd) => { calls.push(cmd); return ""; });
    const git = makeGit({ exec });

    git.commitAll("msg `whoami` and $(id)\nline2");

    expect(calls[1]).toContain("\\`whoami\\`");
    expect(calls[1]).toContain("\\$(id)");
    expect(calls[1]).toContain("\\n");
    expect(calls[1]).not.toMatch(/\n/); // no literal newline in the shell command
  });

  it("propagates exec errors", () => {
    const exec = () => { throw new Error("git: command not found"); };
    const git = makeGit({ exec });
    expect(() => git.commitAll("whatever")).toThrow(/git: command not found/);
  });
});
