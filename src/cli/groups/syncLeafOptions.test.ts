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

const runWorkflowCli = vi.fn(async (..._args: readonly unknown[]) => undefined);
vi.mock("../runWorkflow", () => ({
  runWorkflowCli: (...args: readonly unknown[]) => runWorkflowCli(...args),
}));

const runSpacTimelineIssuers = vi.fn(async (_args: unknown) => []);
vi.mock("../sync/runSpacTimelineIssuers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync/runSpacTimelineIssuers")>();
  return { ...actual, runSpacTimelineIssuers: (args: unknown) => runSpacTimelineIssuers(args) };
});

const filterSpacCiksByHistory = vi.fn(async (ciks: readonly number[], _only: unknown) => [...ciks]);
vi.mock("../sync/spacSyncCiks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync/spacSyncCiks")>();
  return {
    ...actual,
    listSpacProcessCiks: async () => [2, 4],
    filterSpacCiksByHistory: (ciks: readonly number[], only: unknown) =>
      filterSpacCiksByHistory(ciks, only),
    spacUpdatesFiledOnOrAfter: async () => "2026-01-01",
  };
});

import { addSyncCommand } from "./sync";
import { registerSecSyncLeaves } from "../sync/registerSecSyncLeaves";
import { parseIntOption } from "../GlobalOptions";
import {
  clearSyncLeavesForTesting,
  registerSyncLeaf,
  SHARD_LEAF_OPTION,
  type SyncLeafOptionValues,
  type SyncRunContext,
} from "../sync/syncLeaves";

/** What a step saw on the run it was given. */
interface SeenRun {
  readonly step: string;
  readonly ctx: SyncRunContext;
  readonly values: SyncLeafOptionValues | undefined;
}

const seen: SeenRun[] = [];

/** Stands in for the `adv` leaf another package contributes. */
function registerAdvStandIn(): void {
  registerSyncLeaf({
    id: "adv",
    description: "ADV pipeline",
    order: 80,
    inAll: false,
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
  runSpacTimelineIssuers.mockClear();
  filterSpacCiksByHistory.mockClear();
});

afterEach(() => {
  clearSyncLeavesForTesting();
});

describe("sync spacs options", () => {
  it("hands --only and --concurrency to the process step", async () => {
    await runSync(["spacs", "process", "--only", "updates", "-c", "7"]);

    expect(filterSpacCiksByHistory).toHaveBeenCalledWith([2, 4], "updates");
    expect(runSpacTimelineIssuers).toHaveBeenCalledWith(
      expect.objectContaining({ ciks: [2, 4], concurrency: 7 })
    );
  });

  it("processes both kinds at the default concurrency without them", async () => {
    await runSync(["spacs", "process"]);

    expect(filterSpacCiksByHistory).toHaveBeenCalledWith([2, 4], undefined);
    expect(runSpacTimelineIssuers).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 3, filedOnOrAfter: undefined })
    );
  });

  it("rejects an --only value outside the vocabulary", async () => {
    await expect(runSync(["spacs", "process", "--only", "both"])).rejects.toThrow(/Invalid --only/);
  });

  it("hands --full to the identify step", async () => {
    await runSync(["spacs", "identify", "--full"]);

    const tasks = runWorkflowCli.mock.calls.at(-1)?.[0] as ReadonlyArray<{
      defaults: Record<string, unknown>;
    }>;
    expect(tasks[0].defaults).toMatchObject({ full: true });
  });

  it("narrows the issuer list with --shard", async () => {
    await runSync(["spacs", "process", "--shard", "1/2"]);

    // 1/2 is shard 0 of 2, so only the even CIKs — both of these — belong to it.
    expect(runSpacTimelineIssuers).toHaveBeenCalledWith(expect.objectContaining({ ciks: [2, 4] }));
  });
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
