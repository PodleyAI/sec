export interface ProgressOptions {
  readonly total: number;
  readonly label: string;
}

export interface ProgressTracker {
  readonly total: number;
  current: number;
  increment(n?: number): void;
  render(): string;
}

export interface Spinner {
  message: string;
  update(msg: string): void;
  done(msg: string): string;
  fail(msg: string): string;
}

export type StatusType = "success" | "error" | "info" | "warn";

const STATUS_PREFIXES: Record<StatusType, string> = {
  success: "v",
  error: "x",
  info: "->",
  warn: "!",
} as const;

const BAR_WIDTH = 20;

export function statusMessage(type: StatusType, msg: string): string {
  return `${STATUS_PREFIXES[type]} ${msg}`;
}

export function createProgress(options: ProgressOptions): ProgressTracker {
  const tracker: ProgressTracker = {
    total: options.total,
    current: 0,
    increment(n: number = 1): void {
      tracker.current = Math.min(tracker.current + n, tracker.total);
    },
    render(): string {
      const ratio = tracker.total > 0 ? tracker.current / tracker.total : 0;
      const filled = Math.round(ratio * BAR_WIDTH);
      const empty = BAR_WIDTH - filled;
      const bar = "#".repeat(filled) + "-".repeat(empty);
      const pct = Math.round(ratio * 100);
      return `${options.label} [${bar}] ${pct}% ${tracker.current}/${tracker.total}`;
    },
  };
  return tracker;
}

export function createSpinner(message: string): Spinner {
  const spinner: Spinner = {
    message,
    update(msg: string): void {
      spinner.message = msg;
    },
    done(msg: string): string {
      return statusMessage("success", msg);
    },
    fail(msg: string): string {
      return statusMessage("error", msg);
    },
  };
  return spinner;
}
