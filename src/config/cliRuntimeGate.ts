/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";

/** Command groups whose `run` leaf executes a task graph. */
const RUNNING_GROUPS = ["task", "workflow", "agent"];

/**
 * Whether a command about to run needs sec's runtime — database, models and
 * fetch queue — brought up first.
 *
 * Only the leaves that execute a task graph do. Everything else the Workglow
 * CLI offers (`init`, `task list`, `task detail`, `model`, `mcp`, `credential`,
 * `web`, `--help`) reads no SEC data, and booting the runtime for all of them
 * made the CLI unusable before it was configured: `init` exists to write that
 * configuration and could not run without it.
 *
 * `web` is deliberately absent. The server introspects the command tree and
 * spawns each run as a child process, and that child boots for its own command.
 */
export function commandNeedsSecRuntime(command: Command): boolean {
  return command.name() === "run" && RUNNING_GROUPS.includes(command.parent?.name() ?? "");
}
