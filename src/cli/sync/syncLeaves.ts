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
}

export interface SyncStep {
  readonly id: string;
  readonly title: string;
  readonly run: (ctx: SyncRunContext) => Promise<void>;
}

export interface SyncLeaf {
  readonly id: string;
  readonly description: string;
  readonly order: number;
  readonly inAll: boolean;
  readonly steps: readonly SyncStep[];
}

export const EMPTY_SYNC_CONTEXT: SyncRunContext = {
  force: false,
  retryFailed: false,
  full: false,
  from: undefined,
  lookback: 3,
  shard: undefined,
  formTypes: undefined,
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
  stepId: string | undefined
): Promise<void> {
  for (const leafId of leafIds) {
    const leaf = getSyncLeaf(leafId);
    if (leaf === undefined) {
      throw new Error(`Unknown sync leaf '${leafId}'`);
    }

    let steps: readonly SyncStep[];
    if (stepId !== undefined) {
      steps = leaf.steps.filter((step) => step.id === stepId);
      if (steps.length === 0) {
        const validIds = leaf.steps.map((step) => step.id).join(", ");
        throw new Error(`Unknown --step '${stepId}' for sync ${leaf.id}; valid: ${validIds}`);
      }
    } else {
      steps = leaf.steps;
    }

    for (const step of steps) {
      await step.run(ctx);
    }
  }
}
