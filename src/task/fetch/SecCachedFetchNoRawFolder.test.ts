/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: LicenseRef-Proprietary
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "workglow";
import { globalServiceRegistry, type TaskTypeName } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { resetFetchCacheWarningForTesting, SecCachedFetchTask } from "./SecCachedFetchTask";

interface DocInput {
  readonly name: string;
  readonly response_type?: string;
}

class TestCachedFetchTask extends SecCachedFetchTask<DocInput> {
  // Annotated, not inferred: this suite subclasses it below to narrow the
  // schema, and a literal type here would make that subclass's own `type` a
  // static-side mismatch.
  static readonly type: TaskTypeName = "TestCachedFetchTask";
  static readonly category = "Hidden";
  static readonly title = "Test cached fetch";

  inputToFileName(input: DocInput): string {
    return `docs/${input.name}`;
  }
  inputToUrl(input: DocInput): string {
    return `https://www.sec.gov/Archives/${input.name}`;
  }
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDependencyInjectionsForTesting();
  resetFetchCacheWarningForTesting();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

/**
 * Without `SEC_RAW_DATA_FOLDER` there is no cache object at all, so every fetch
 * re-downloads and nothing is read from disk — while each fetch still reports
 * success. Dropping this one variable from an `.env.local` silently disabled
 * caching across the whole CLI, and the resulting symptom read as a cache bug
 * rather than a configuration one.
 */
describe("SecCachedFetchTask without SEC_RAW_DATA_FOLDER", () => {
  it("warns that no fetch cache was installed", () => {
    new TestCachedFetchTask({ name: "a.txt", response_type: "text" });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? "");
    // Names the variable to set, and the consequence of leaving it unset --
    // a bare "cache disabled" would not tell an operator what to do.
    expect(message).toContain("SEC_RAW_DATA_FOLDER");
    expect(message).toMatch(/re-download/i);
  });

  it("warns only ONCE per process, however many tasks are built", () => {
    // A sweep constructs thousands of fetch tasks. Warning per construction
    // would bury the message it is trying to deliver.
    for (let i = 0; i < 50; i += 1) {
      new TestCachedFetchTask({ name: `doc-${i}.txt`, response_type: "text" });
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the folder IS configured", () => {
    const raw = mkdtempSync(path.join(tmpdir(), "sec-cached-nowarn-"));
    try {
      globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, raw);
      new TestCachedFetchTask({ name: "a.txt", response_type: "text" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      rmSync(raw, { recursive: true, force: true });
    }
  });

  it("does not warn for a task that is going to throw on the schema hazard", () => {
    // The `"stream"` + narrowed-schema check refuses outright. Warning as well
    // would put a configuration note in front of a hard error about something
    // else, which is the wrong thing to read first.
    //
    // The schema must be narrowed explicitly to reach that branch: since the
    // fetch output schema was fixed to declare the real binary `body` port, an
    // ordinary subclass inherits it and streams fine.
    class NarrowedSchemaTask extends TestCachedFetchTask {
      static readonly type = "NarrowedSchemaTask";
      static outputSchema(): ReturnType<typeof SecCachedFetchTask.outputSchema> {
        return {} as ReturnType<typeof SecCachedFetchTask.outputSchema>;
      }
    }

    expect(() => new NarrowedSchemaTask({ name: "a.txt", response_type: "stream" })).toThrow(
      /binary `body` output port/
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
