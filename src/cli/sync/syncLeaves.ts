/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Flags parsed for one leaf, keyed by commander's camelCase option name. */
export type SyncLeafOptionValues = Readonly<Record<string, unknown>>;

export interface SyncLeafOption {
  /** Commander flag spec, e.g. `--lookback <n>`. */
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
}

/**
 * One stage of bringing local data forward.
 *
 * A leaf is one command and one task graph. There is no step machinery: the
 * stages that had several steps were the form sweeps, and they are gone with
 * the extractors, so a leaf that ran its steps as one graph and a leaf that was
 * one graph became the same thing.
 */
export interface SyncLeaf {
  /** Command name under the group, e.g. `submissions`. */
  readonly id: string;
  readonly description: string;
  /** Position in the ordered run; lower goes first. */
  readonly order: number;
  /** Whether the bare group command runs this leaf. */
  readonly inAll: boolean;
  readonly options?: readonly SyncLeafOption[] | undefined;
  /** Runs the leaf. `values` is what the operator's flags parsed to. */
  readonly run: (values: SyncLeafOptionValues) => Promise<void>;
}

const leaves = new Map<string, SyncLeaf>();

export function registerSyncLeaf(leaf: SyncLeaf): void {
  leaves.set(leaf.id, leaf);
}

export function getSyncLeaf(id: string): SyncLeaf | undefined {
  return leaves.get(id);
}

/** Every registered leaf, in run order. */
export function listSyncLeaves(): readonly SyncLeaf[] {
  return [...leaves.values()].sort((a, b) => a.order - b.order);
}

/** Test-only: registration is process-global. */
export function clearSyncLeavesForTesting(): void {
  leaves.clear();
}

/**
 * Runs every `inAll` leaf in order.
 *
 * A leaf that throws is contained — reported, and the leaves behind it still
 * run — and the caller sees the failures so the run can exit non-zero on the
 * summary rather than on the first stage.
 */
export async function runSyncLeaves(
  values: SyncLeafOptionValues,
  onLeaf?: (leaf: SyncLeaf) => void
): Promise<readonly { readonly id: string; readonly error: unknown }[]> {
  const failures: { readonly id: string; readonly error: unknown }[] = [];
  for (const leaf of listSyncLeaves()) {
    if (!leaf.inAll) continue;
    onLeaf?.(leaf);
    try {
      await leaf.run(values);
    } catch (error) {
      failures.push({ id: leaf.id, error });
    }
  }
  return failures;
}
