import { isDryRun } from "./isDryRun";
import { drainNextSteps, renderNextSteps } from "./nextSteps";
import { statusMessage } from "./output/Progress";

export interface RunCommandOptions {
  readonly onError?: (error: unknown) => void;
  readonly force?: boolean;
}

export async function runCommand(
  action: () => Promise<void>,
  options?: RunCommandOptions
): Promise<number> {
  try {
    if (isDryRun()) {
      const suffix = options?.force ? " (force — all items will be reprocessed)" : "";
      console.log(statusMessage("info", `Dry run${suffix} — no data will be written`));
    }
    await action();
    renderNextSteps(drainNextSteps());
    // Unconditional, so an exit code the action assigned to `process.exitCode`
    // itself is discarded here. To fail a command, THROW — that is the only
    // signal this function forwards (see `fetch golden-fixtures --verify`).
    process.exitCode = 0;
    return 0;
  } catch (error: unknown) {
    if (options?.onError) {
      options.onError(error);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(statusMessage("error", message) + "\n");
    }
    process.exitCode = 1;
    return 1;
  } finally {
    // A failed command suggests nothing: the error carries its own remedy, and
    // a "Next:" block under it points at work that did not happen. Drained
    // rather than left, so a long-lived process — the web console runs many
    // commands in one — cannot leak one command's steps into the next.
    drainNextSteps();
  }
}
