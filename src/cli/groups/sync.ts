import type { Command } from "commander";
import { parseShardOption } from "../../task/forms/formsSweep";
import { parseIntOption } from "../GlobalOptions";
import { runCommand } from "../runCommand";
import { registerSecSyncLeaves } from "../sync/registerSecSyncLeaves";
import { DEFAULT_SPAC_ISSUER_CONCURRENCY } from "../sync/runSpacTimelineIssuers";
import { parseSpacProcessOnly } from "../sync/spacSyncCiks";
import {
  EMPTY_SYNC_CONTEXT,
  listSyncLeaves,
  runSyncLeaves,
  type SyncLeaf,
  type SyncRunContext,
} from "../sync/syncLeaves";

interface AllSyncOpts {
  readonly force: boolean;
  readonly retryFailed: boolean;
  readonly from?: string;
  readonly lookback: number;
}

export function validateLookback(lookback: number): number {
  if (lookback < 1) {
    throw new Error("--lookback must be at least 1");
  }
  return lookback;
}

function contextFromAllOpts(opts: AllSyncOpts): SyncRunContext {
  return {
    ...EMPTY_SYNC_CONTEXT,
    force: opts.force,
    retryFailed: opts.retryFailed,
    from: opts.from,
    lookback: validateLookback(opts.lookback),
  };
}

function addOneLeafCommand(sync: Command, leaf: SyncLeaf): void {
  if (leaf.id === "forms") {
    sync
      .command("forms <types>")
      .description(leaf.description)
      .option(
        "--shard <i/N>",
        "Process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores"
      )
      .action(async (types: string, opts: { shard?: string }) => {
        await runCommand(async () => {
          const formTypes = types.split(",");
          const shard = parseShardOption(opts.shard);
          await runSyncLeaves(["forms"], { ...EMPTY_SYNC_CONTEXT, shard, formTypes }, undefined);
        });
      });
    return;
  }

  const cmd = sync.command(leaf.id).description(leaf.description);

  if (leaf.steps.length > 1) {
    const names = leaf.steps.map((step) => step.id).join(" | ");
    cmd.option("--step <name>", `Run only this step (${names})`);
  }

  if (leaf.id === "submissions") {
    cmd
      .option("--force", "Reprocess submissions, ignoring processed state", false)
      .option(
        "--from <date>",
        "Exclusive catch-up start (YYYY-MM-DD); fetch begins the day after this date"
      )
      .option("--lookback <n>", "Completed days to re-fetch (default 3)", parseIntOption, 3);
  }

  if (leaf.id === "facts") {
    cmd
      .option("--force", "Reprocess all items, ignoring processed state", false)
      .option("--retry-failed", "Also re-fetch CIKs whose last facts processing failed", false);
  }

  if (leaf.id === "spacs") {
    cmd
      .option(
        "--full",
        "Rescan every entity instead of only those whose submissions changed since the last run",
        false
      )
      .option(
        "--shard <i/N>",
        "Process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores"
      )
      .option(
        "--only <kind>",
        "never-processed = SPACs with no successful run yet; updates = already-processed SPACs, filings since the last SPAC process run (default: both, including historical leftover)",
        parseSpacProcessOnly
      )
      .option(
        "-c, --concurrency <n>",
        "How many ISSUERS to process at once (default 3). Filings within an issuer are always serial.",
        parseIntOption,
        DEFAULT_SPAC_ISSUER_CONCURRENCY
      );
  }

  if (leaf.id === "portals" || leaf.id === "crowdfunding" || leaf.id === "reg-a") {
    cmd.option(
      "--shard <i/N>",
      "Process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores"
    );
  }

  cmd.action(
    async (opts: {
      step?: string;
      force?: boolean;
      retryFailed?: boolean;
      from?: string;
      lookback?: number;
      full?: boolean;
      shard?: string;
      only?: ReturnType<typeof parseSpacProcessOnly>;
      concurrency?: number;
    }) => {
      await runCommand(
        async () => {
          const shard = parseShardOption(opts.shard);
          let ctx: SyncRunContext = { ...EMPTY_SYNC_CONTEXT, shard };

          if (leaf.id === "submissions") {
            ctx = {
              ...ctx,
              force: opts.force ?? false,
              from: opts.from,
              lookback: validateLookback(opts.lookback ?? EMPTY_SYNC_CONTEXT.lookback),
            };
          }

          if (leaf.id === "facts") {
            ctx = {
              ...ctx,
              force: opts.force ?? false,
              retryFailed: opts.retryFailed ?? false,
            };
          }

          if (leaf.id === "spacs") {
            ctx = {
              ...ctx,
              full: opts.full ?? false,
              only: opts.only,
              concurrency: Math.max(1, opts.concurrency ?? DEFAULT_SPAC_ISSUER_CONCURRENCY),
            };
          }

          await runSyncLeaves([leaf.id], ctx, opts.step);
        },
        leaf.id === "submissions" || leaf.id === "facts" ? { force: opts.force } : undefined
      );
    }
  );
}

export function addSyncLeafCommands(program: Command): void {
  let sync = program.commands.find((c) => c.name() === "sync");
  if (!sync) {
    sync = program.command("sync").description("Bring local SEC data forward to today");
  }
  const existing = new Set(sync.commands.map((c) => c.name()));

  if (!existing.has("all")) {
    sync
      .command("all")
      .description("Run every inAll sync leaf in order")
      .option("--force", "Reprocess submissions/facts watermarks", false)
      .option("--retry-failed", "Also retry failed facts fetches", false)
      .option(
        "--from <date>",
        "Exclusive catch-up start (YYYY-MM-DD); fetch begins the day after this date"
      )
      .option("--lookback <n>", "Completed days to re-fetch (default 3)", parseIntOption, 3)
      .action(async (opts: AllSyncOpts) => {
        if (opts.force) {
          console.warn(
            "Note: --force no longer affects form processing. Forms re-run only via version bumps (see 'sec version')."
          );
        }
        await runCommand(
          async () => {
            await runSyncLeaves(
              listSyncLeaves()
                .filter((leaf) => leaf.inAll)
                .map((leaf) => leaf.id),
              contextFromAllOpts(opts),
              undefined
            );
          },
          { force: opts.force }
        );
      });
  }

  for (const leaf of listSyncLeaves()) {
    if (existing.has(leaf.id)) continue;
    addOneLeafCommand(sync, leaf);
  }
}

export function addSyncCommand(program: Command): void {
  registerSecSyncLeaves();
  program.command("sync").description("Bring local SEC data forward to today");
  addSyncLeafCommands(program);
}
