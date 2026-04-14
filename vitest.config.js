import { defineConfig } from "vitest/config";

// Disable file-level parallelism: tune-applyProposal.test.js and
// tune-proposer.test.js both touch real content/*.json files, and parallel
// workers can interleave writes — leaving files truncated or in a
// mid-write state (seen first as spurious "Unexpected end of JSON input"
// errors during Phase 2.1). Tests within a single file still run serially
// by default, which is all the isolation we need.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
