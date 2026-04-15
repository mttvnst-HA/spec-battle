// Tiny wrapper over `git add`/`git commit` with an injectable exec so tests
// don't shell out. The production factory uses execSync; tests substitute a fake.

import { execSync } from "node:child_process";

const defaultExec = (cmd) => execSync(cmd, { encoding: "utf-8" });

export function makeGit({ exec = defaultExec } = {}) {
  return {
    commitAll(message) {
      // Scoped to `content/` — the only path the tune proposer mutates
      // (via writeBundle → applyProposal). Previously `git add -A`, which
      // accidentally swept up stray files like `tune-run.log` when a run
      // was piped through tee. The scoped form is sufficient for every
      // accepted bundle and avoids polluting the commit with incidental
      // working-tree files.
      exec("git add content/");
      const escaped = message
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/`/g, "\\`")
        .replace(/\$/g, "\\$")
        .replace(/\n/g, "\\n");
      exec(`git commit -m "${escaped}"`);
    },
  };
}
