/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a command should listen for SIGINT/SIGTERM to tear down the
 * Postgres pool.
 *
 * The web console owns those signals itself (stop the server, then the
 * entrypoint `finally` closes the pool). Every other command is what the
 * console spawns as a child; Abort is SIGINT to that child, and without a
 * listener the process dies before `closePgPool()` runs.
 */
export function shouldInstallCliSignalTeardown(commandName: string): boolean {
  return commandName !== "web";
}

export interface CliSignalTeardown {
  readonly close: () => Promise<void>;
  readonly exit?: (code: number) => void;
}

/**
 * Closes CLI resources on SIGINT/SIGTERM, then exits.
 *
 * Adding a listener removes Node/Bun's default "die immediately" action for
 * that signal. The close must therefore happen here — the entrypoint `finally`
 * does not run if the process is about to exit from the signal.
 */
let uninstallCurrent: (() => void) | undefined;

export function installCliSignalTeardown(options: CliSignalTeardown): () => void {
  if (uninstallCurrent) return uninstallCurrent;

  let shuttingDown = false;

  const shutdown = (code: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const exit = options.exit ?? ((status: number) => process.exit(status));
    void options.close().finally(() => exit(code));
  };

  const onInt = (): void => shutdown(130);
  const onTerm = (): void => shutdown(143);
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  uninstallCurrent = () => {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    uninstallCurrent = undefined;
  };
  return uninstallCurrent;
}
