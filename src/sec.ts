#!/usr/bin/env bun
import { program } from "commander";
import {
  installCliSignalTeardown,
  shouldInstallCliSignalTeardown,
} from "./cli/installCliSignalTeardown";
import { shutdownCliResources } from "./cli/shutdownCliResources";
import { applyGlobalOptions } from "./cli/GlobalOptions";
import { statusMessage } from "./cli/output/Progress";
import { AddCommands } from "./commands";
import { SecCliConfigurationError } from "./config/EnvToDI";

program
  // Set explicitly rather than left to commander's argv[1] inference: the web
  // console renders it as the command line to run, so `dist/sec.js` or a
  // `bun src/sec.ts` invocation must still say `sec`.
  .name("sec")
  .version("2.0.0")
  .description("SEC EDGAR data pipeline — fetch, store, and query SEC filings");

applyGlobalOptions(program);
AddCommands(program);

let signalsInstalled = false;
program.hook("preAction", (_thisCommand, actionCommand) => {
  if (signalsInstalled) return;
  if (!shouldInstallCliSignalTeardown(actionCommand.name())) return;
  signalsInstalled = true;
  // Abort in the web console is SIGINT to this process. Close the pool here
  // rather than waiting for `finally`: a listener replaces the default exit,
  // and without this the backends stay idle on the server.
  installCliSignalTeardown({ close: shutdownCliResources });
});

let primaryError: unknown;
try {
  await program.parseAsync(process.argv);
} catch (e) {
  primaryError = e;
  if (e instanceof SecCliConfigurationError) {
    console.error(statusMessage("error", e.message));
    process.exitCode = 1;
  }
} finally {
  // Run shutdown via allSettled so a crashing cleanup step can't mask the
  // primary command failure or skip later cleanup. process.exit() would
  // bypass this block entirely, so we use exitCode + rethrow instead.
  await shutdownCliResources();
}

if (primaryError !== undefined && !(primaryError instanceof SecCliConfigurationError)) {
  throw primaryError;
}
