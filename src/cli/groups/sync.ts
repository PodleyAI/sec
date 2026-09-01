import type { Command } from "commander";
import { parseShardOption } from "../../task/forms/formsSweep";
import { parseIntOption } from "../GlobalOptions";
import { runCommand } from "../runCommand";
import { registerSecSyncLeaves } from "../sync/registerSecSyncLeaves";
import {
  EMPTY_SYNC_CONTEXT,
  listSyncLeaves,
  runSyncLeaves,
  type SyncLeaf,
  type SyncLeafOptionValues,
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

/**
 * The options this file reads by name off any leaf command, because their
 * values are fields of the shared {@link SyncRunContext}. Whatever else a leaf
 * declared arrives in the same object and is handed back to that leaf
 * untouched, which is why the index signature is here.
 */
interface LeafOpts extends SyncLeafOptionValues {
  readonly force?: boolean;
  readonly retryFailed?: boolean;
  readonly from?: string;
  readonly lookback?: number;
  readonly shard?: string;
  readonly simple?: boolean;
}

/**
 * Declares a leaf's own options on one command.
 *
 * Applied per subcommand rather than once on the group: commander does not
 * hand a parent's options to a subcommand's action, so a `--shard` declared on
 * the group would parse and then be dropped on the floor.
 *
 * `stepId` is the step this command runs, or undefined for the leaf itself and
 * for its `all` — an option naming steps appears only on those it named.
 */
function applyLeafOptions(cmd: Command, leaf: SyncLeaf, stepId: string | undefined): Command {
  for (const option of leaf.options?.declare ?? []) {
    if (option.steps !== undefined && (stepId === undefined || !option.steps.includes(stepId))) {
      continue;
    }
    if (option.parse !== undefined) {
      cmd.option(option.flags, option.description, option.parse, option.defaultValue);
      continue;
    }
    if (typeof option.defaultValue === "number") {
      // Commander stores this default as-is and hands back the flag's raw
      // string once it IS given, so the option would answer with two types.
      throw new Error(`sync option '${option.flags}' needs a parser to carry a numeric default`);
    }
    cmd.option(option.flags, option.description, option.defaultValue);
  }
  return cmd;
}

/** Runs a leaf, or one step of it, under the options that command declared. */
async function runLeaf(leaf: SyncLeaf, opts: LeafOpts, stepId: string | undefined): Promise<void> {
  await runCommand(
    async () => {
      // The shared fields are read the same way whichever leaf is running: a
      // leaf that declared none of these flags leaves them undefined, which
      // lands on the defaults `EMPTY_SYNC_CONTEXT` already carries. Only the
      // leaf's own declarations can say anything more, and they say it last.
      const ctx: SyncRunContext = {
        ...EMPTY_SYNC_CONTEXT,
        force: opts.force ?? false,
        retryFailed: opts.retryFailed ?? false,
        from: opts.from,
        lookback: validateLookback(opts.lookback ?? EMPTY_SYNC_CONTEXT.lookback),
        shard: parseShardOption(opts.shard),
        isolatedStep: stepId !== undefined,
        simple: opts.simple ?? false,
        ...leaf.options?.readContext?.(opts),
      };

      await runSyncLeaves([leaf.id], ctx, stepId, opts);
    },
    leaf.id === "submissions" || leaf.id === "facts" ? { force: opts.force } : undefined
  );
}

function addOneLeafCommand(sync: Command, leaf: SyncLeaf): void {
  if (leaf.id === "forms") {
    const forms = sync.command("forms <types>").description(leaf.description);
    applyLeafOptions(forms, leaf, undefined);
    forms.action(async (types: string, opts: { shard?: string }) => {
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
  // so `sync quotes all` would only be a longer way to say `sync quotes`. That
  // command IS the step, so a step-scoped option is declared against it —
  // passing `undefined` here would silently drop every option the leaf scoped
  // to its only step, leaving a flag declared nowhere and rejected by
  // commander.
  if (leaf.steps.length <= 1) {
    applyLeafOptions(cmd, leaf, leaf.steps[0]?.id);
    cmd.action(async (opts: LeafOpts) => runLeaf(leaf, opts, undefined));
    return;
  }

  // A multi-step leaf is a group: `all` runs the leaf, and each step runs
  // alone. That replaces `--step <name>`, which hid the choices behind
  // `--help` and could not be completed by a shell.
  const all = cmd.command("all").description(`Run every ${leaf.id} step in order`);
  applyLeafOptions(all, leaf, undefined);
  all.action(async (opts: LeafOpts) => runLeaf(leaf, opts, undefined));

  for (const step of leaf.steps) {
    const stepCmd = cmd.command(step.id).description(step.title);
    // Every step takes the leaf's options: they configure the leaf's work, and
    // which part of it is running does not change what `--shard` or `--force`
    // mean.
    applyLeafOptions(stepCmd, leaf, step.id);
    stepCmd.action(async (opts: LeafOpts) => runLeaf(leaf, opts, step.id));
  }

  // Deliberately no action on the group. Bare `sync <leaf>` names a group
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
