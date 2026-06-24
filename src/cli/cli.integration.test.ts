import { describe, it, expect } from "bun:test";

const ENV = {
  ...process.env,
  SEC_DB_FOLDER: "/tmp/sec-cli-integration-test",
  SEC_DB_NAME: "edgar",
  SEC_RAW_DATA_FOLDER: "/tmp/sec-cli-integration-test-raw",
};

const SEC_TS = new URL("../sec.ts", import.meta.url).pathname;

async function runCli(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", "run", SEC_TS, ...args], {
    env: ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return stdout + stderr;
}

describe("CLI v2 integration", () => {
  it("should show help with all command groups", async () => {
    const output = await runCli("--help");
    expect(output).toContain("bootstrap");
    expect(output).toContain("sync");
    expect(output).toContain("update");
    expect(output).toContain("fetch");
    expect(output).toContain("query");
    expect(output).toContain("db");
    expect(output).toContain("init");
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
});
