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

/** Options any leaf command may carry; each leaf uses the subset it declares. */
interface LeafOpts {
  readonly force?: boolean;
  readonly retryFailed?: boolean;
  readonly from?: string;
  readonly lookback?: number;
  readonly full?: boolean;
  readonly shard?: string;
  readonly only?: ReturnType<typeof parseSpacProcessOnly>;
  readonly concurrency?: number;
  readonly simple?: boolean;
}

/**
 * Declares a leaf's options on one command.
 *
 * Applied per subcommand rather than once on the group: commander does not
 * hand a parent's options to a subcommand's action, so a `--shard` declared on
 * the group would parse and then be dropped on the floor.
 */
function applyLeafOptions(cmd: Command, leafId: string): Command {
  if (leafId === "submissions") {
    cmd
      .option("--force", "Reprocess submissions, ignoring processed state", false)
      .option(
        "--from <date>",
        "Exclusive catch-up start (YYYY-MM-DD); fetch begins the day after this date"
      )
      .option("--lookback <n>", "Completed days to re-fetch (default 3)", parseIntOption, 3);
  }

  if (leafId === "facts") {
    cmd
      .option("--force", "Reprocess all items, ignoring processed state", false)
      .option("--retry-failed", "Also re-fetch CIKs whose last facts processing failed", false);
  }

  if (leafId === "spacs") {
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

  if (leafId === "portals" || leafId === "crowdfunding" || leafId === "reg-a") {
    cmd.option(
      "--shard <i/N>",
      "Process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores"
    );
  }

  return cmd;
}

/** Options for `sync adv form-d` (standalone Form D sweep; replaces removed `sync form-d`). */
function applyAdvFormDStepOptions(cmd: Command): Command {
  return cmd
    .option(
      "--simple",
      "Standalone Form D sweep only (formerly sync form-d); required when running this step alone",
      false
    )
    .option(
      "--shard <i/N>",
      "Process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores"
    );
}

/** Runs a leaf, or one step of it, under the options that command declared. */
async function runLeaf(leaf: SyncLeaf, opts: LeafOpts, stepId: string | undefined): Promise<void> {
  await runCommand(
    async () => {
      const shard = parseShardOption(opts.shard);
      let ctx: SyncRunContext = {
        ...EMPTY_SYNC_CONTEXT,
        shard,
        isolatedStep: stepId !== undefined,
        simple: opts.simple ?? false,
      };

      if (leaf.id === "submissions") {
        ctx = {
          ...ctx,
          force: opts.force ?? false,
          from: opts.from,
          lookback: validateLookback(opts.lookback ?? EMPTY_SYNC_CONTEXT.lookback),
        };
      }

      if (leaf.id === "facts") {
        ctx = { ...ctx, force: opts.force ?? false, retryFailed: opts.retryFailed ?? false };
      }

      if (leaf.id === "spacs") {
        ctx = {
          ...ctx,
          full: opts.full ?? false,
          only: opts.only,
          concurrency: Math.max(1, opts.concurrency ?? DEFAULT_SPAC_ISSUER_CONCURRENCY),
        };
      }

      await runSyncLeaves([leaf.id], ctx, stepId);
    },
    leaf.id === "submissions" || leaf.id === "facts" ? { force: opts.force } : undefined
  );
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

  // A single-step leaf is its own command: there is nothing to choose between,
  // so `sync quotes all` would only be a longer way to say `sync quotes`.
  if (leaf.steps.length <= 1) {
    applyLeafOptions(cmd, leaf.id);
    cmd.action(async (opts: LeafOpts) => runLeaf(leaf, opts, undefined));
    return;
  }

  // A multi-step leaf is a group: `all` runs the leaf, and each step runs
  // alone. That replaces `--step <name>`, which hid the choices behind
  // `--help` and could not be completed by a shell.
  const all = cmd.command("all").description(`Run every ${leaf.id} step in order`);
  applyLeafOptions(all, leaf.id);
  all.action(async (opts: LeafOpts) => runLeaf(leaf, opts, undefined));

  for (const step of leaf.steps) {
    const stepCmd = cmd.command(step.id).description(step.title);
    // Every step takes the leaf's options: they configure the leaf's work, and
    // which part of it is running does not change what `--shard` or `--force`
    // mean.
    applyLeafOptions(stepCmd, leaf.id);
    if (leaf.id === "adv" && step.id === "form-d") {
      applyAdvFormDStepOptions(stepCmd);
    }
    stepCmd.action(async (opts: LeafOpts) => runLeaf(leaf, opts, step.id));
  }

  // Deliberately no action on the group. Bare `sync spacs` names a group
  // rather than a job, and commander answers a missing subcommand with the
  // command's help — which is the listing we want, and which an action would
  // instead route through the CLI's preAction hook, demanding configuration to
  // print a help screen.
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
