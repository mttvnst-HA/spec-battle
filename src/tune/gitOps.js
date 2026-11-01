// Tiny wrapper over `git add`/`git commit` with an injectable exec so tests
// don't shell out. The production factory uses execFileSync; tests substitute
// a fake.
//
// Commands are passed as (file, args[]) and run WITHOUT a shell. The commit
// message carries LLM-authored text (bundle.summary), so building a shell
// command string from it was an injection risk — and the old bash-style
// escaping did not protect cmd.exe on Windows, where `\"` ends the quoted
// region and leaves `&`/`|` live. With an argument array, git receives the
// message verbatim on every platform, including real newlines.

import { execFileSync } from "node:child_process";

const defaultExec = (file, args) =>
  execFileSync(file, args, { encoding: "utf-8", windowsHide: true });

export function makeGit({ exec = defaultExec } = {}) {
  return {
    commitAll(message) {
      if (typeof message !== "string" || message.trim() === "") {
        throw new TypeError("commitAll: message must be a non-empty string");
      }
      // Scoped to `content/` — the only path the tune proposer mutates
      // (via writeBundle → applyProposal). Previously `git add -A`, which
      // accidentally swept up stray files like `tune-run.log` when a run
      // was piped through tee. The scoped form is sufficient for every
      // accepted bundle and avoids polluting the commit with incidental
      // working-tree files.
      exec("git", ["add", "--", "content/"]);
      // `--` is not used after -m because the message is the option's value;
      // passing it as its own argv entry means a leading "-" cannot be read
      // as a git flag.
      exec("git", ["commit", "-m", message]);
    },
  };
}
