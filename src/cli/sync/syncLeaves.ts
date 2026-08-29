/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FormsShard } from "../../task/forms/formsSweep";

export interface SyncRunContext {
  readonly force: boolean;
  readonly retryFailed: boolean;
  readonly full: boolean;
  readonly from: string | undefined;
  readonly lookback: number;
  readonly shard: FormsShard | undefined;
  readonly formTypes: string[] | undefined;
  /**
   * True when a multi-step leaf is invoked as `sync <leaf> <step>` rather than
   * `sync <leaf> all` or as one step inside `sync all`.
   */
  readonly isolatedStep: boolean;
  /**
   * Standalone Form D sweep (`sync adv form-d --simple`). Required when
   * {@link isolatedStep} targets the adv `form-d` step; ignored elsewhere.
   */
  readonly simple: boolean;
  /**
   * `sync documents --limit`: how many filings one conversion run takes.
   * Undefined means the leaf's own default — a backfill is many bounded runs
   * rather than one that holds a process for a day.
   */
  readonly limit: number | undefined;
  /** `sync documents --cik`: convert one issuer's filings rather than a sweep. */
  readonly cik: number | undefined;
  /**
   * `sync documents --all-8k`: convert 8-Ks from every filer rather than only
   * from the ones the registered conversion gate admits. Off by default,
   * because every reporting company files them and a lifecycle model built out
   * of them is the only reason they are convertible at all.
   */
  readonly all8k: boolean;
  /**
   * `sync documents --download-only`: fetch each selected filing into the
   * accession-doc cache and stop, writing no rows. The download half is
   * rate-limited by EDGAR and the conversion half is not, so they are worth
   * running — and resuming — separately.
   */
  readonly downloadOnly: boolean;
}

/**
 * Commander's parsed values for one leaf command, keyed by camel-cased flag
 * (`--all-8k` arrives as `all8k`). Values are whatever that option's parser
 * produced, so a leaf narrows the ones it declared; see {@link SyncLeafOptions}.
 */
export type SyncLeafOptionValues = Readonly<Record<string, unknown>>;

/** One CLI option a leaf declares for itself, in commander's own terms. */
export interface SyncLeafOption {
  /** Commander flag spec, e.g. `-c, --concurrency <n>`. */
  readonly flags: string;
  readonly description: string;
  /** Commander's per-option parser. Without one the raw string is kept. */
  readonly parse?: ((value: string, previous: unknown) => unknown) | undefined;
  /**
   * The value when the flag is absent. Commander accepts an unparsed default
   * only for string and boolean flags, so a numeric one must arrive through
   * {@link parse} — which is where the number comes from anyway.
   */
  readonly defaultValue?: string | number | boolean | undefined;
  /**
   * Step ids that carry this option. Absent means every command the leaf
   * produces: the leaf itself, its `all`, and each of its steps.
   */
  readonly steps?: readonly string[] | undefined;
}

/**
 * A leaf's own CLI options.
 *
 * The leaf declares them and says which shared context fields they set; the
 * parsed values are then handed back to its steps verbatim, so a leaf's own
 * vocabulary never has to be named by the package hosting the `sync` group. A
 * leaf a downstream package contributes declares its options exactly the way
 * one registered here does.
 */
export interface SyncLeafOptions {
  readonly declare: readonly SyncLeafOption[];
  /**
   * The shared context fields these options set. Only for values
   * {@link SyncRunContext} already names — a leaf's own vocabulary stays in the
   * values handed to its steps, where the leaf itself gives it a type.
   */
  readonly readContext?: ((values: SyncLeafOptionValues) => Partial<SyncRunContext>) | undefined;
}

/**
 * The `--shard i/N` declaration every sweeping leaf reuses. Its value reaches
 * {@link SyncRunContext.shard} through the shared parse, so a leaf declares it
 * and then reads `ctx.shard`: there is nothing per-leaf about what it means.
 */
export const SHARD_LEAF_OPTION: SyncLeafOption = {
  flags: "--shard <i/N>",
  description:
    "Process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores",
};

export interface SyncStep {
  readonly id: string;
  readonly title: string;
  /**
   * `values` is what the command the operator typed parsed, for the options
   * this leaf declared. It is undefined when no command stands behind the run —
   * `sync all`, or a caller invoking the step directly — and the leaf's own
   * defaults apply there.
   */
  readonly run: (ctx: SyncRunContext, values?: SyncLeafOptionValues) => Promise<void>;
}

export interface SyncLeaf {
  readonly id: string;
  readonly description: string;
  readonly order: number;
  readonly inAll: boolean;
  readonly steps: readonly SyncStep[];
  /** The options this leaf's commands carry. See {@link SyncLeafOptions}. */
  readonly options?: SyncLeafOptions | undefined;
  /**
   * Runs the whole leaf as one unit — what `sync <leaf> all` invokes.
   *
   * Steps exist so `sync <leaf> <step>` can select one, and running them one at a time
   * means one task graph each — so a leaf whose steps are really N tasks of a
   * single job reports as N separate runs, and a watching console sees the
   * first and then a new one replacing it. A leaf that can express itself as
   * one graph says so here; `steps` stays the vocabulary for selecting part of
   * it, and must produce the same work either way.
   */
  readonly runAll?: (ctx: SyncRunContext, values?: SyncLeafOptionValues) => Promise<void>;
}

export const EMPTY_SYNC_CONTEXT: SyncRunContext = {
  force: false,
  retryFailed: false,
  full: false,
  from: undefined,
  lookback: 3,
  shard: undefined,
  formTypes: undefined,
  isolatedStep: false,
  simple: false,
  limit: undefined,
  cik: undefined,
  all8k: false,
  downloadOnly: false,
};

const syncLeaves = new Map<string, SyncLeaf>();

export function registerSyncLeaf(leaf: SyncLeaf): void {
  syncLeaves.set(leaf.id, leaf);
}

export function getSyncLeaf(id: string): SyncLeaf | undefined {
  return syncLeaves.get(id);
}

export function listSyncLeaves(): readonly SyncLeaf[] {
  return [...syncLeaves.values()].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.id.localeCompare(right.id);
  });
}

export function clearSyncLeavesForTesting(): void {
  syncLeaves.clear();
}

export async function runSyncLeaves(
  leafIds: readonly string[],
  ctx: SyncRunContext,
  stepId: string | undefined,
  values?: SyncLeafOptionValues
): Promise<void> {
  for (const leafId of leafIds) {
    const leaf = getSyncLeaf(leafId);
    if (leaf === undefined) {
      throw new Error(`Unknown sync leaf '${leafId}'`);
    }

    if (stepId === undefined && leaf.runAll !== undefined) {
      await leaf.runAll(ctx, values);
      continue;
    }

    let steps: readonly SyncStep[];
    if (stepId !== undefined) {
      steps = leaf.steps.filter((step) => step.id === stepId);
      if (steps.length === 0) {
        const validIds = leaf.steps.map((step) => step.id).join(", ");
        throw new Error(`Unknown step '${stepId}' for sync ${leaf.id}; valid: ${validIds}`);
      }
    } else {
      steps = leaf.steps;
    }

    for (const step of steps) {
      await step.run(ctx, values);
    }
  }
}
