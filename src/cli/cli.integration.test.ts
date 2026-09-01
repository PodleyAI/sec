import { describe, expect, it } from "vitest";
import { cliEnv, runCliProcess } from "./testing/runCliProcess";

const ENV = cliEnv({
  SEC_DB_FOLDER: "/tmp/sec-cli-integration-test",
  SEC_DB_NAME: "edgar",
  SEC_RAW_DATA_FOLDER: "/tmp/sec-cli-integration-test-raw",
});

const SEC_TS = new URL("../sec.ts", import.meta.url).pathname;

/**
 * Run the CLI in a subprocess and assert it exited cleanly before returning its
 * output.
 *
 * Asserting the exit code is what makes this suite readable when the command
 * graph fails to BOOT. Every case here is a `--help` invocation, so a module
 * that fails to load takes all of them down at once — and without this check
 * eight cases report "expected output to contain 'bootstrap'" while the actual
 * defect ("Cannot find module …") sits unexamined in the received value. The
 * exit code names the incident; the containment checks describe the CLI.
 *
 * `--help` and `--version` both exit 0 in commander, so a single expected code
 * covers every case here.
 */
async function runCli(...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await runCliProcess(["bun", "run", SEC_TS, ...args], ENV);
  const output = stdout + stderr;
  expect(exitCode, `sec ${args.join(" ")} exited ${exitCode}:\n${output}`).toBe(0);
  return output;
}

describe("CLI v2 integration", () => {
  it("should show help with all command groups", async () => {
    // Every top-level name AddCommands registers, not a sample of them. A group
    // whose registrar throws or is dropped is otherwise invisible here: the
    // remaining ones still print, and the assertions still pass. `issuer` in
    // particular went unasserted, and it is the only top-level evidence that
    // registerIssuerCommands ran at all. `spac` and `underwriter` are not here:
    // the family tier was the whole of both groups and a deployment of this
    // package alone offers neither.
    const output = await runCli("--help");
    for (const group of [
      "bootstrap",
      "sync",
      "fetch",
      "query",
      "db",
      "init",
      "version",
      "issuer",
      "editorial",
      "extractor",
      // Inherited from @workglow/cli, and the only evidence it registered.
      "web",
    ]) {
      expect(output, group).toContain(group);
    }
  });

  it("should show global options", async () => {
    const output = await runCli("--help");
    expect(output).toContain("--dry-run");
  });

  it("should show version 2.0.0", async () => {
    const output = await runCli("--version");
    expect(output.trim()).toBe("2.0.0");
  });

  it("should show bootstrap subcommands", async () => {
    const output = await runCli("bootstrap", "--help");
    expect(output).toContain("download");
    expect(output).toContain("ingest");
    expect(output).toContain("--skip-download");
    expect(output).toContain("--skip-ingest");
    expect(output).toContain("--skip-forms");
  });

  it("should show query subcommands", async () => {
    const output = await runCli("query", "--help");
    expect(output).toContain("entities");
    expect(output).toContain("filings");
    expect(output).toContain("offerings");
    expect(output).toContain("crowdfunding");
    expect(output).toContain("facts");
    expect(output).toContain("persons");
  });

  it("should show fetch subcommands", async () => {
    const output = await runCli("fetch", "--help");
    expect(output).toContain("submissions");
    expect(output).toContain("facts");
    expect(output).toContain("form");
    expect(output).toContain("doc");
  });

  it("should show sync subcommands", async () => {
    const output = await runCli("sync", "--help");
    for (const sub of [
      "all",
      "submissions",
      "facts",
      "portals",
      "crowdfunding",
      "reg-a",
      "forms",
    ]) {
      expect(output, sub).toContain(sub);
    }
    // A leaf a downstream package registers, like `adv` below.
    expect(output).not.toContain("spacs");
  });

  it("should reject unknown sync adv subcommand", async () => {
    const { stdout, stderr, exitCode } = await runCliProcess(
      ["bun", "run", SEC_TS, "sync", "adv"],
      ENV
    );
    const output = stdout + stderr;
    expect(exitCode, `sec sync adv exited ${exitCode}:\n${output}`).not.toBe(0);
    expect(output).toMatch(/unknown command/i);
  });

  it("should show sync forms shard option", async () => {
    const output = await runCli("sync", "forms", "--help");
    expect(output).toContain("--shard");
  });

  it("should show db subcommands", async () => {
    const output = await runCli("db", "--help");
    expect(output).toContain("setup");
    expect(output).toContain("status");
    expect(output).toContain("stats");
    expect(output).toContain("reset");
  });
});
