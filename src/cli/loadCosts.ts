/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createInterface } from "node:readline/promises";
import { isJsonOutput } from "./isJsonOutput";

export interface LoadCost {
  readonly id: string;
  /** Compressed download size, as a person would say it. */
  readonly size: string;
  /** Rough wall-clock, download and ingest stated separately when both matter. */
  readonly time: string;
}

/**
 * What a bulk load actually costs, so it can be said before it is spent.
 *
 * Ranges, not measurements: EDGAR's throughput varies by hours of the day and
 * the ingest by disk. They are here to stop someone starting a two-hour job
 * expecting a two-minute one, which is the only precision that matters.
 *
 * Refresh them when they drift. A number nobody has checked in two years is
 * worse than no number, because it is believed.
 */
export const LOAD_COSTS: Readonly<Record<string, LoadCost>> = {
  ciks: { id: "ciks", size: "8 MB", time: "~30 seconds" },
  submissions: { id: "submissions", size: "~14 GB", time: "~25 min download + ~2 h ingest" },
  facts: { id: "facts", size: "~1.2 GB", time: "~5 min download + ~40 min ingest" },
  adv: { id: "adv", size: "~180 MB", time: "~2 minutes" },
};

/** The rows a `load <type>` would spend, in the order it would spend them. */
export function costsFor(type: string): readonly LoadCost[] {
  if (type === "all") return [LOAD_COSTS.ciks!, LOAD_COSTS.submissions!, LOAD_COSTS.facts!];
  const cost = LOAD_COSTS[type];
  return cost === undefined ? [] : [cost];
}

/** Renders the cost table. */
export function renderCosts(costs: readonly LoadCost[]): void {
  if (costs.length === 0) return;
  const idWidth = Math.max(...costs.map((cost) => cost.id.length));
  const sizeWidth = Math.max(...costs.map((cost) => cost.size.length));
  console.log("");
  for (const cost of costs) {
    console.log(`  ${cost.id.padEnd(idWidth)}  ${cost.size.padStart(sizeWidth)}  ${cost.time}`);
  }
  console.log("");
}

/**
 * Prints the price, then asks.
 *
 * Skipped entirely when there is no TTY to ask on — a scripted run has already
 * decided — and by `--yes`. Under `--json` nothing is printed at all, since the
 * output is being parsed.
 */
export async function confirmLoad(
  costs: readonly LoadCost[],
  options: { readonly yes?: boolean }
): Promise<boolean> {
  if (options.yes === true || isJsonOutput()) return true;
  if (!process.stdin.isTTY) return true;
  renderCosts(costs);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("  Continue? [y/N] ");
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}
