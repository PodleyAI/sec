import { statusMessage } from "./output/Progress";
import { isDryRun } from "./isDryRun";

export interface RunCommandOptions {
  readonly onError?: (error: unknown) => void;
}

export async function runCommand(
  action: () => Promise<void>,
  options?: RunCommandOptions
): Promise<number> {
  try {
    if (isDryRun()) {
      console.log(statusMessage("info", "Dry run — no data will be written"));
    }
    await action();
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
  }
}
