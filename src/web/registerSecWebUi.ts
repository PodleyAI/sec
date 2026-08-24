/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { registerSecCommandAnnotations, registerSecFieldAnnotations } from "./secAnnotations";
import { registerSecFieldWidgets } from "./secFieldWidgets";
import { registerSecPanels } from "./secPanels";
import { registerSecStatusWidgets } from "./secStatusWidgets";

/**
 * Everything sec contributes to the web console, in one call.
 *
 * Registration is deliberately inert: it puts closures in registries and
 * touches no DI, no database and no network, so it can run during `AddCommands`
 * — before the runtime is up, and on every command including the ones that run
 * with no database configured. The reads happen when a page asks, by which
 * point the `web` command's own bootstrap has run.
 *
 * A superset (embarc-data) inherits all of it by calling `AddCommands`, and
 * layers its own registrations on top; the seams are keyed so a later
 * registration of the same id replaces rather than duplicates.
 */
export function registerSecWebUi(program?: Command): void {
  registerSecFieldWidgets();
  // The program, when the caller has one, is read for the per-command
  // `--format` vocabularies — the one annotation that cannot be stated once,
  // because this CLI declares six different ones.
  registerSecFieldAnnotations(program);
  registerSecCommandAnnotations();
  registerSecPanels();
  registerSecStatusWidgets();
}
