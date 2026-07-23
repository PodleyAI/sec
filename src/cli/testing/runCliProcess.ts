/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn a CLI subprocess and capture stdout/stderr separately.
 *
 * Uses `node:child_process` (which Bun implements natively) rather than
 * `Bun.spawn`: under the vitest runner the `Bun.spawn` + `new Response(...)`
 * capture crossed stderr into the captured stdout, so provider-registration
 * `console.warn` lines leaked into `--format json` output and broke JSON.parse.
 * The node API keeps the two streams cleanly separated on both runtimes.
 */
export function runCliProcess(
  command: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<CliRunResult> {
  const [cmd, ...args] = command;
  return new Promise<CliRunResult>((resolve, reject) => {
    const proc = spawn(cmd, args, { env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
