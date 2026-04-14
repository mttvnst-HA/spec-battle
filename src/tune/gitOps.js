// Tiny wrapper over `git add`/`git commit` with an injectable exec so tests
// don't shell out. The production factory uses execSync; tests substitute a fake.

import { execSync } from "node:child_process";

const defaultExec = (cmd) => execSync(cmd, { encoding: "utf-8" });

export function makeGit({ exec = defaultExec } = {}) {
  return {
    commitAll(message) {
      exec("git add -A");
      const escaped = message.replace(/"/g, '\\"');
      exec(`git commit -m "${escaped}"`);
    },
  };
}
