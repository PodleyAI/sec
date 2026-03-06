import type { Command } from "commander";

export interface GlobalOptions {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly dryRun: boolean;
  readonly color: boolean;
  readonly concurrency: number | undefined;
}

export function applyGlobalOptions(program: Command): Command {
  return program
    .option("--json", "Force JSON output", false)
    .option("--verbose", "Show detailed logs", false)
    .option("--dry-run", "Show what would happen without changes", false)
    .option("--no-color", "Disable colored output")
    .option("--concurrency <n>", "Override default concurrency", parseIntOption);
}

export function parseGlobalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.opts();
  return {
    json: opts.json ?? false,
    verbose: opts.verbose ?? false,
    dryRun: opts.dryRun ?? false,
    color: opts.color ?? true,
    concurrency: opts.concurrency,
  };
}

export function parseIntOption(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`"${value}" is not a valid number`);
  }
  return parsed;
}
