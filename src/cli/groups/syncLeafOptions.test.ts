/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A leaf's options are the leaf's own.
 *
 * `sec` builds one command per leaf and per step; every option it puts on those
 * commands comes from the leaf that declared it, so a leaf contributed by
 * another package carries options without `sec` naming it. These tests drive
 * real argv through commander and check the values arrive where the leaf reads
 * them — a flag that parses and is then dropped between the command and the
 * work looks exactly like success.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseIntOption } from "../GlobalOptions";
import { registerSecSyncLeaves } from "../sync/registerSecSyncLeaves";
import {
  clearSyncLeavesForTesting,
  registerSyncLeaf,
  SHARD_LEAF_OPTION,
  type SyncLeafOptionValues,
  type SyncRunContext,
} from "../sync/syncLeaves";
import { addSyncCommand } from "./sync";

const runWorkflowCli = vi.fn(async (..._args: readonly unknown[]) => undefined);
vi.mock("../runWorkflow", () => ({
  runWorkflowCli: (...args: readonly unknown[]) => runWorkflowCli(...args),
}));

/** What a step saw on the run it was given. */
interface SeenRun {
  readonly step: string;
  readonly ctx: SyncRunContext;
  readonly values: SyncLeafOptionValues | undefined;
}

const seen: SeenRun[] = [];

/**
 * Stands in for the `adv` leaf another package contributes, declaring the two
 * options that leaf really declares for its Form D step.
 */
function registerAdvStandIn(): void {
  registerSyncLeaf({
    id: "adv",
    description: "ADV pipeline",
    order: 80,
    inAll: false,
    options: {
      declare: [
        {
          flags: "--simple",
          description: "Standalone Form D sweep only; required when running this step alone",
          defaultValue: false,
          steps: ["form-d"],
        },
        { ...SHARD_LEAF_OPTION, steps: ["form-d"] },
      ],
    },
    steps: [
      {
        id: "form-d",
        title: "Process Form D filings",
        run: async (ctx, values) => void seen.push({ step: "form-d", ctx, values }),
      },
      {
        id: "ingest",
        title: "Ingest latest ADV monthly period",
        run: async (ctx, values) => void seen.push({ step: "ingest", ctx, values }),
      },
    ],
  });
}

/** A contributed leaf declaring options `sec` has never heard of. */
function registerContributedLeaf(): void {
  registerSyncLeaf({
    id: "quotes",
    description: "Refresh quotes",
    order: 90,
    inAll: false,
    options: {
      declare: [
        SHARD_LEAF_OPTION,
        {
          flags: "--depth <n>",
          description: "How many days back to refresh",
          parse: parseIntOption,
          defaultValue: 2,
        },
        {
          flags: "--rebuild",
          description: "Discard the existing series first",
          defaultValue: false,
          steps: ["backfill"],
        },
      ],
      readContext: (values) => ({ full: values.rebuild === true }),
    },
    steps: [
      {
        id: "refresh",
        title: "Refresh",
        run: async (ctx, values) => void seen.push({ step: "refresh", ctx, values }),
      },
      {
        id: "backfill",
        title: "Backfill",
        run: async (ctx, values) => void seen.push({ step: "backfill", ctx, values }),
      },
    ],
  });
}

async function runSync(argv: readonly string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  clearSyncLeavesForTesting();
  registerSecSyncLeaves();
  registerAdvStandIn();
  registerContributedLeaf();
  addSyncCommand(program);
  await program.parseAsync(["node", "sec", "sync", ...argv]);
}

function commandFor(path: readonly string[]): Command {
  const program = new Command();
  clearSyncLeavesForTesting();
  registerSecSyncLeaves();
  registerAdvStandIn();
  registerContributedLeaf();
  addSyncCommand(program);
  let cmd = program.commands.find((c) => c.name() === "sync")!;
  for (const name of path) {
    cmd = cmd.commands.find((c) => c.name() === name)!;
  }
  return cmd;
}

function flagsOf(path: readonly string[]): readonly (string | undefined)[] {
  return commandFor(path).options.map((option) => option.long);
}

beforeEach(() => {
  seen.length = 0;
  runWorkflowCli.mockClear();
});

afterEach(() => {
  clearSyncLeavesForTesting();
});

describe("a contributed leaf's options", () => {
  it("declares them on the leaf's own commands with no branch in sec", async () => {
    await runSync(["quotes", "refresh", "--depth", "9", "--shard", "1/3"]);

    expect(seen).toHaveLength(1);
    expect(seen[0].values).toMatchObject({ depth: 9 });
    expect(seen[0].ctx.shard).toEqual({ index: 0, count: 3 });
  });

  it("applies a declared default when the flag is absent", async () => {
    await runSync(["quotes", "refresh"]);

    expect(seen[0].values).toMatchObject({ depth: 2 });
  });

  it("sets the shared context fields the leaf says its options set", async () => {
    await runSync(["quotes", "backfill", "--rebuild"]);

    expect(seen[0].ctx.full).toBe(true);
  });

  it("puts a step-scoped option only on the step that named it", () => {
    expect(flagsOf(["quotes", "backfill"])).toContain("--rebuild");
    expect(flagsOf(["quotes", "refresh"])).not.toContain("--rebuild");
    expect(flagsOf(["quotes", "all"])).not.toContain("--rebuild");
    // The leaf's unscoped options are on every one of its commands.
    for (const name of ["all", "refresh", "backfill"]) {
      expect(flagsOf(["quotes", name]), `sync quotes ${name}`).toContain("--depth");
    }
  });
});

describe("sync adv form-d --simple", () => {
  it("still reaches the run context on the step that declares it", async () => {
    await runSync(["adv", "form-d", "--simple"]);

    expect(seen).toHaveLength(1);
    expect(seen[0].ctx.simple).toBe(true);
    expect(seen[0].ctx.isolatedStep).toBe(true);
  });

  it("is off for the same step inside the whole leaf", async () => {
    await runSync(["adv", "form-d"]);

    expect(seen[0].ctx.simple).toBe(false);
  });

  it("belongs to that step alone", () => {
    expect(flagsOf(["adv", "form-d"])).toContain("--simple");
    expect(flagsOf(["adv", "ingest"])).not.toContain("--simple");
  });
});
