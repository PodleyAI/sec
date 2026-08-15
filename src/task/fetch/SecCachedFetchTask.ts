/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";
import {
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  globalServiceRegistry,
  IExecuteContext,
  TaskConfig,
  TaskOutput,
} from "workglow";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { YYYYdMMdDD } from "../../util/parseDate";
import { SecFetchFileOutputCache } from "./SecFetchFileOutputCache";
import { SecFetchTask } from "./SecFetchTask";

export type response_type = "text" | "json" | "blob" | "arraybuffer";
export interface SecCachedFetchTaskInput {
  cik: number;
  date?: YYYYdMMdDD;
  response_type?: response_type;
}

/**
 * File-cacheable fetch types. FetchUrlTask also accepts `"stream"`, which
 * materializes no derived port — SecFetchFileOutputCache cannot persist that.
 */
function isMaterializingResponseType(value: unknown): value is response_type {
  return value === "text" || value === "json" || value === "blob" || value === "arraybuffer";
}

function guessResponseType(urlstr: string, input: FetchUrlTaskInput): response_type {
  if (isMaterializingResponseType(input.response_type)) {
    return input.response_type;
  }
  const url = new URL(urlstr);
  const ext = url.pathname.split(".").pop() ?? "json";
  switch (ext) {
    case "idx":
    case "txt":
    case "xml":
    case "xbrl":
    case "csv":
    case "html":
    case "htm":
      return "text";
    case "json":
      return "json";
    case "pdf":
    case "doc":
    case "docx":
    case "xls":
    case "xlsx":
    case "ppt":
    case "pptx":
    case "gif":
    case "jpg":
    case "jpeg":
    case "png":
    case "ico":
    case "webp":
      return "blob";
    default:
      return "blob";
  }
}

export abstract class SecCachedFetchTask<
  I = SecCachedFetchTaskInput,
  O extends TaskOutput = FetchUrlTaskOutput,
> extends SecFetchTask<I & FetchUrlTaskInput, O> {
  static type = "SecCachedFetchTask";
  static category = "Hidden";
  static cachePolicy = { kind: "deterministic" } as const;
  static immutable = false;

  static inputSchema() {
    return {} as any;
  }

  static outputSchema() {
    return {} as any;
  }

  abstract inputToFileName(input: I): string;
  abstract inputToUrl(input: I): string;

  constructor(input: I, config: Partial<TaskConfig> = {}) {
    super(input as I & FetchUrlTaskInput, config);

    // response_type drives both Workglow's fetch handling and the file-cache
    // serializer. We resolve it once here, after super() has populated
    // `defaults`/`runInputData`, so that downstream `execute()` calls and
    // any cache lookups see a consistent value.
    const fetchInput = this.defaults as FetchUrlTaskInput & I;
    if (!isMaterializingResponseType(fetchInput.response_type)) {
      const response_type = guessResponseType(this.inputToUrl(fetchInput as I), fetchInput);
      fetchInput.response_type = response_type;
      (this.runInputData as FetchUrlTaskInput).response_type = response_type;
    }

    if (globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
      const globalPath = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
      const folderPath = globalPath.startsWith("/")
        ? path.join(globalPath)
        : path.join(process.cwd(), globalPath);
      this.runConfig.outputCache = new SecFetchFileOutputCache({
        folderPath: folderPath,
        inputToFileName: this.inputToFileName.bind(this),
      });
    }
  }

  /**
   * The task input is a domain key (a CIK, a date, an accession), never a URL,
   * so the request has to be built here. This is the seam every dispatch path
   * runs through — `execute()` is not: a streamable task is dispatched to
   * `executeStream()`, which never calls it, so an override there would leave
   * the fetch pointed at the unresolved input.
   */
  protected override async resolveFetchInput(
    input: FetchUrlTaskInput,
    _context: IExecuteContext
  ): Promise<FetchUrlTaskInput> {
    const domainInput = input as I & FetchUrlTaskInput;
    const url = this.inputToUrl(domainInput);
    const response_type = guessResponseType(url, input);

    const fetchInput: FetchUrlTaskInput = {
      url: url,
      method: "GET",
      response_type: response_type,
    };
    // Preserve any caller-supplied headers (merged onto the default
    // SecUserAgent header by SecFetchTask's constructor) — without this a
    // caller-overridden User-Agent set via `defaults`/constructor input is
    // silently dropped before reaching the wire.
    if (input.headers) {
      fetchInput.headers = input.headers;
    }

    return fetchInput;
  }
}
