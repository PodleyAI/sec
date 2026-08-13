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
    // remaining ones still print, and the assertions still pass. `underwriter`
    // and `issuer` in particular went unasserted, and they are the only
    // top-level evidence that registerUnderwriterFamilyCommands ran at all.
    const output = await runCli("--help");
    for (const group of [
      "bootstrap",
      "sync",
      "update",
      "fetch",
      "query",
      "db",
      "init",
      "version",
      "resolve",
      "canonical",
      "spac",
      "underwriter",
      "issuer",
      "editorial",
      "extractor",
      "eval",
    ]) {
      expect(output, group).toContain(group);
    }
  });

  it("should show canonical subcommands from every resolver-kind registrar", async () => {
    // The only proof that registerSponsorFamilyCommands ran. It also creates
    // the top-level `spac` group — but registerSpacCommands find-or-creates the
    // same name, so a missing sponsor-family registration still leaves `spac`
    // in the root help. `canonical sponsor-family` has no such second author.
    const output = await runCli("canonical", "--help");
    expect(output).toContain("person");
    expect(output).toContain("company");
    expect(output).toContain("sponsor-family");
    expect(output).toContain("underwriter-family");
  });

  it("should show spac subcommands from both registrars that share the group", async () => {
    // Two registrars contribute to one group, so asserting the group name
    // separates neither. `by-family` comes from the sponsor-family registrar;
    // the rest from the spac registrar.
    const output = await runCli("spac", "--help");
    expect(output).toContain("by-family");
    expect(output).toContain("process");
    expect(output).toContain("report");
    expect(output).toContain("history");
    expect(output).toContain("candidates");
  });

  it("should show eval subcommands", async () => {
    const output = await runCli("eval", "--help");
    expect(output).toContain("extract");
    expect(output).toContain("s1");
    expect(output).toContain("unit-terms");
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

  it("should show update subcommands", async () => {
    const output = await runCli("update", "--help");
    expect(output).toContain("submissions");
    expect(output).toContain("facts");
    expect(output).toContain("forms");
  });

  it("should show db subcommands", async () => {
    const output = await runCli("db", "--help");
    expect(output).toContain("setup");
    expect(output).toContain("status");
    expect(output).toContain("stats");
    expect(output).toContain("reset");
  });

  it("should show spac download subcommands", async () => {
    const output = await runCli("spac", "download", "--help");
    expect(output).toContain("registration");
    expect(output).toContain("8k");
    expect(output).toContain("everything");
  });
});
