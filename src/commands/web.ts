/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { parseIntOption } from "../cli/GlobalOptions";
import { statusMessage } from "../cli/output/Progress";
import { startWebServer } from "../web/server";

/** Default listen port. Nothing standard sits here, and it is easy to type. */
export const DEFAULT_WEB_PORT = 8787;

/**
 * Loopback by default, and deliberately not configurable to a wildcard by
 * accident.
 *
 * The server has no authentication and every page can start work that spends
 * real money on model calls and real quota against EDGAR, so binding it to an
 * interface the network can reach must be a decision an operator states out
 * loud (`--host 0.0.0.0`), never the default they get by typing `sec web`.
 */
export const DEFAULT_WEB_HOST = "127.0.0.1";

export function registerWebCommand(program: Command): void {
  program
    .command("web")
    .description(
      "Serve a local web interface for inspecting and running the SPAC pipeline: candidates, " +
        "per-issuer report and history, the per-filing process checklist, document conversion, " +
        "extractor results, and multi-model comparison"
    )
    .option("-p, --port <n>", "Port to listen on", parseIntOption, DEFAULT_WEB_PORT)
    .option(
      "--host <host>",
      "Interface to bind. The default is loopback: the server has no authentication and its " +
        "buttons spend model and EDGAR quota, so exposing it is an explicit choice.",
      DEFAULT_WEB_HOST
    )
    .action(async (opts: { port: number; host: string }, command: Command) => {
      const handle = await startWebServer({ port: opts.port, host: opts.host });
      // The program's own name rather than a literal: this command is inherited
      // by superset CLIs through `AddCommands`, and `embarc-data web`
      // announcing itself as `sec web` names a binary nobody ran.
      const cliName = command.parent?.name() ?? "sec";
      console.log(statusMessage("success", `${cliName} web listening on ${handle.url}`));
      if (opts.host !== DEFAULT_WEB_HOST && opts.host !== "localhost") {
        console.error(
          statusMessage(
            "warn",
            `bound to ${opts.host} — this interface has no authentication and can start runs ` +
              `that spend model and EDGAR quota. Do not expose it to an untrusted network.`
          )
        );
      }
      console.log(statusMessage("info", "Press Ctrl-C to stop."));

      // The command deliberately never resolves: the CLI's teardown (job queue,
      // database handles, model workers) runs when the action returns, and the
      // server needs all three for as long as it is serving. Ctrl-C unblocks it,
      // and the teardown then runs exactly once, in the usual place.
      await new Promise<void>((resolve) => {
        const shutdown = (): void => {
          console.log(statusMessage("info", "shutting down"));
          void handle.close().then(() => resolve());
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      });
    });
}
