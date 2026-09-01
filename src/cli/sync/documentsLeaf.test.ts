/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `sync documents` and its options.
 *
 * The leaf reads `ctx.formTypes`, `ctx.from`, `ctx.cik` and `ctx.limit`, and
 * every one of those is a separate chance for a flag to be declared, parsed, and
 * then dropped on the floor between the command and the task — which is exactly
 * what `--types` did before it had a flag of its own. A dropped `--cik` is the
 * costly one: it converts the newest 500 filings of EVERY filer, which reports
 * as success.
 */
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addSyncCommand } from "../groups/sync";
import { registerSecSyncLeaves } from "./registerSecSyncLeaves";

const runWorkflowCli = vi.fn(async (..._args: readonly unknown[]) => undefined);
vi.mock("../runWorkflow", () => ({
  runWorkflowCli: (...args: readonly unknown[]) => runWorkflowCli(...args),
}));

/** The defaults the leaf handed its task on this run. */
function convertDefaults(): Record<string, unknown> {
  const tasks = runWorkflowCli.mock.calls.at(-1)?.[0] as
    ReadonlyArray<{ defaults: Record<string, unknown> }> | undefined;
  if (tasks === undefined) throw new Error("the leaf ran no workflow");
  return tasks[0].defaults;
}

async function run(argv: readonly string[]): Promise<Record<string, unknown>> {
  const program = new Command();
  program.exitOverride();
  registerSecSyncLeaves();
  addSyncCommand(program);
  await program.parseAsync(["node", "sec", "sync", "documents", ...argv]);
  return convertDefaults();
}

describe("sync documents", () => {
  beforeEach(() => {
    runWorkflowCli.mockClear();
  });

  it("declares the options its help promises", () => {
    const program = new Command();
    registerSecSyncLeaves();
    addSyncCommand(program);
    const help = program.commands
      .find((c) => c.name() === "sync")!
      .commands.find((c) => c.name() === "documents")!
      .helpInformation();
    for (const flag of ["--types", "--since", "--cik", "--limit", "--force"]) {
      expect(help, `${flag} is missing from \`sync documents --help\``).toContain(flag);
    }
  });

  it("converts one issuer when given --cik", async () => {
    expect(await run(["--cik", "1811882"])).toMatchObject({ cik: 1811882 });
  });

  it("sweeps every filer when not given one", async () => {
    expect(await run([])).toMatchObject({ cik: undefined });
  });

  it("passes the other narrowing options through", async () => {
    const defaults = await run([
      "--types",
      "S-1-xbrl,424B4",
      "--since",
      "2026-01-01",
      "--limit",
      "25",
      "--force",
    ]);
    expect(defaults).toMatchObject({ since: "2026-01-01", limit: 25, force: true });
    // `--types` speaks the same vocabulary as `sync forms`, where a type is an
    // EXTRACTOR id: naming S-1 asks for the registration family it heads, since
    // converting an S-1 and not its amendments would be a document with no
    // history.
    expect(defaults.forms).toEqual(expect.arrayContaining(["S-1", "S-1/A", "424B4"]));
  });

  it("defaults the limit rather than converting without a bound", async () => {
    expect(await run([])).toMatchObject({ limit: 500 });
  });

  it("refuses a CIK that is not one", async () => {
    // Rejected at parse time. A mistyped CIK that fell through would convert
    // the newest 500 filings of every filer and report success.
    await expect(run(["--cik", "not-a-cik"])).rejects.toThrow();
  });
});
