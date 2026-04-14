// Subprocess transport for the Claude Code CLI.
// Synchronous: execFileSync blocks until the child exits or times out.
// exec is injectable so tests never spawn a real subprocess.

import { execFileSync } from "node:child_process";

/**
 * Default exec: invokes `<executable> -p <prompt> --output-format json --model <model>`
 * with a hard timeout (ms). Returns stdout as a UTF-8 string. Throws on nonzero
 * exit or timeout (the error's .signal property is "SIGTERM" for timeout).
 *
 * No shell interpolation — execFileSync arg-array form avoids shell injection.
 */
function defaultExec({ prompt, model, timeoutMs, executable }) {
  const args = ["-p", prompt, "--output-format", "json", "--model", model];
  return execFileSync(executable, args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,   // 10 MiB — prompt+response can be large
  });
}

/**
 * Creates a transport object with a single `send(prompt) → string` method.
 * Tests inject a fake `exec`.
 *
 * `executable` defaults to bare "claude" (resolved via PATH). On machines
 * where the Claude Code CLI is bundled with the desktop app but not on PATH
 * (e.g. Windows ...\AppData\Roaming\Claude\claude-code\<version>\claude.exe),
 * the caller should pass an absolute path instead. scripts/tune.js reads
 * process.env.TUNE_CLAUDE_BIN for this purpose.
 */
export function createCliTransport({
  exec = defaultExec,
  model = "claude-sonnet-4-6",
  timeoutMs = 120_000,
  executable = "claude",
} = {}) {
  return {
    send(prompt) {
      if (typeof prompt !== "string" || prompt.length === 0) {
        throw new Error("claudeTransport.send: prompt must be a non-empty string");
      }
      return exec({ prompt, model, timeoutMs, executable });
    },
  };
}
