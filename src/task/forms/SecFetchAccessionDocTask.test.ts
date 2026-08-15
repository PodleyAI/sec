/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { FetchUrlTaskInput, IExecuteContext } from "workglow";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";

describe("SecFetchAccessionDocTask", () => {
  it("constructs: URL rewrite lives on resolveFetchInput, not execute", async () => {
    // FetchUrlTask is streamable: TaskRunner never calls execute(), and the
    // constructor throws if a subclass overrides it. A cache-miss fetch
    // constructs this task; that throw used to surface as FETCH_ERROR on every
    // uncached filing (BHAV 2097288 424B4, Form 3/4, D).
    const task = new SecFetchAccessionDocTask({
      cik: 2097288,
      accessionNumber: "0001213900-26-012345",
      fileName: "ea123.htm",
    });
    const resolved = await (
      task as unknown as {
        resolveFetchInput: (
          input: FetchUrlTaskInput,
          context: IExecuteContext
        ) => Promise<FetchUrlTaskInput>;
      }
    ).resolveFetchInput(
      {
        cik: 2097288,
        accessionNumber: "0001213900-26-012345",
        fileName: "ea123.htm",
      } as FetchUrlTaskInput,
      {} as IExecuteContext
    );
    expect(resolved.url).toBe(
      "https://www.sec.gov/Archives/edgar/data/0002097288/000121390026012345/ea123.htm"
    );
    expect(resolved.method).toBe("GET");
    expect(resolved.response_type).toBe("text");
  });

  it('does not pass response_type "stream" through to the file-cache serializer', async () => {
    // FetchUrlTaskInput now includes "stream", which materializes no derived
    // port. SecFetchFileOutputCache writes json/text/blob/arraybuffer, so a
    // cached SEC fetch must pick a materializing type from the URL even when
    // a caller (or FetchUrlTask's default) asked for a stream.
    const task = new SecFetchAccessionDocTask({
      cik: 2097288,
      accessionNumber: "0001213900-26-012345",
      fileName: "ea123.htm",
    });
    const resolved = await (
      task as unknown as {
        resolveFetchInput: (
          input: FetchUrlTaskInput,
          context: IExecuteContext
        ) => Promise<FetchUrlTaskInput>;
      }
    ).resolveFetchInput(
      {
        cik: 2097288,
        accessionNumber: "0001213900-26-012345",
        fileName: "ea123.htm",
        response_type: "stream",
      } as FetchUrlTaskInput,
      {} as IExecuteContext
    );
    expect(resolved.response_type).toBe("text");
  });
});
