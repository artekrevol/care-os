/**
 * Trampoline for `pnpm demo:reset`. The actual reset logic lives in
 * `@workspace/api-server` (it needs that package's seed module and DB
 * client). This trampoline just delegates so the root-level `pnpm
 * demo:reset` alias has a stable home in @workspace/scripts.
 */
import { spawn } from "node:child_process";

const child = spawn(
  "pnpm",
  ["--filter", "@workspace/api-server", "run", "demo:reset"],
  { stdio: "inherit" },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
