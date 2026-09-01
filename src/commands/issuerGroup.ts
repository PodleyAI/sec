/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";

/**
 * The `sec issuer` group, found or created.
 *
 * It exists apart from any one of its subcommands because it has no owner: the
 * subcommands under it answer unrelated questions and are registered from
 * unrelated places, including — once the identity tier is a downstream
 * package's — from a different repository. Whoever registers first creates the
 * group and the rest attach to it, so no subcommand's registration order
 * decides whether another one exists.
 */
export function issuerCommandGroup(program: Command): Command {
  const existing = program.commands.find((c) => c.name() === "issuer");
  if (existing !== undefined) return existing;
  return program.command("issuer").description("Issuer queries");
}
