#!/usr/bin/env bun

import { program } from "commander";
import {
  AddCommands,
  applyGlobalOptions,
  closeDb,
  closePgPool,
  getTaskQueueRegistry,
  SecCliConfigurationError,
  statusMessage,
  terminateWorkers,
} from "./index";

program
  .version("2.0.0")
  .description("SEC EDGAR data pipeline — fetch, store, and query SEC filings");

applyGlobalOptions(program);
AddCommands(program);

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
  const cleanups = await Promise.allSettled([
    getTaskQueueRegistry().stopQueues(),
    Promise.resolve().then(() => closeDb()),
    closePgPool(),
    // Terminate worker-backed AI providers (local models) so the process exits
    // instead of hanging on live worker threads until their idle timeout.
    terminateWorkers(),
  ]);
  for (const result of cleanups) {
    if (result.status === "rejected") {
      console.error("Cleanup error:", result.reason);
    }
  }
}

if (primaryError !== undefined && !(primaryError instanceof SecCliConfigurationError)) {
  throw primaryError;
}
