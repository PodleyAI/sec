import { statusMessage } from "./output/Progress";

export interface RunCommandOptions {
  readonly dryRun?: boolean;
  readonly onError?: (error: unknown) => void;
}

export async function runCommand(
  action: () => Promise<void>,
  options?: RunCommandOptions
): Promise<number> {
  if (options?.dryRun) {
    process.exitCode = 0;
    return 0;
  }

  try {
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
