/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installCliSignalTeardown,
  shouldInstallCliSignalTeardown,
} from "./installCliSignalTeardown";

const uninstalls: Array<() => void> = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall();
});

describe("shouldInstallCliSignalTeardown", () => {
  it("skips the web console, which owns SIGINT itself", () => {
    expect(shouldInstallCliSignalTeardown("web")).toBe(false);
  });

  it("installs for commands the console spawns as children", () => {
    expect(shouldInstallCliSignalTeardown("reg-a")).toBe(true);
    expect(shouldInstallCliSignalTeardown("seed")).toBe(true);
  });
});

describe("installCliSignalTeardown", () => {
  it("closes resources on SIGINT then exits 130, which is what Abort sends", async () => {
    const order: string[] = [];
    uninstalls.push(
      installCliSignalTeardown({
        close: async () => {
          order.push("close");
        },
        exit: (code) => {
          order.push(`exit:${code}`);
        },
      })
    );

    process.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["close", "exit:130"]);
  });

  it("closes resources on SIGTERM then exits 143", async () => {
    const order: string[] = [];
    uninstalls.push(
      installCliSignalTeardown({
        close: async () => {
          order.push("close");
        },
        exit: (code) => {
          order.push(`exit:${code}`);
        },
      })
    );

    process.emit("SIGTERM");
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["close", "exit:143"]);
  });

  it("ignores a second install so nested commander preAction cannot double-close", async () => {
    let closes = 0;
    const first = installCliSignalTeardown({
      close: async () => {
        closes += 1;
      },
      exit: () => {},
    });
    uninstalls.push(first);
    const second = installCliSignalTeardown({
      close: async () => {
        closes += 1;
      },
      exit: () => {},
    });
    expect(second).toBe(first);

    process.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();

    expect(closes).toBe(1);
  });

  it("closes only once if both signals fire", async () => {
    let closes = 0;
    const exits: number[] = [];
    uninstalls.push(
      installCliSignalTeardown({
        close: async () => {
          closes += 1;
        },
        exit: (code) => {
          exits.push(code);
        },
      })
    );

    process.emit("SIGINT");
    process.emit("SIGTERM");
    await Promise.resolve();
    await Promise.resolve();

    expect(closes).toBe(1);
    expect(exits).toEqual([130]);
  });

  it("closes the pool and exits 130 when Abort sends a real SIGINT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-sigint-"));
    const marker = join(dir, "closed");
    const fixture = new URL("./installCliSignalTeardown.fixture.ts", import.meta.url).pathname;
    const child = spawn("bun", ["run", fixture], {
      env: { ...process.env, CLOSE_MARKER: marker },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const started = Date.now();
    while (!stdout.includes("ready") && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(stdout, "fixture never became ready").toContain("ready");
    child.kill("SIGINT");
    const [code] = (await once(child, "close")) as [number | null];
    expect(code).toBe(130);
    expect(readFileSync(marker, "utf8")).toBe("closed");
  }, 10_000);
});
