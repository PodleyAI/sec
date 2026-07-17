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

function guessResponseType(urlstr: string, input: FetchUrlTaskInput): response_type {
  const url = new URL(urlstr);
  const ext = url.pathname.split(".").pop() ?? "json";
  let response_type = input.response_type;

  if (!response_type) {
    switch (ext) {
      case "idx":
      case "txt":
      case "xml":
      case "xbrl":
      case "csv":
      case "html":
      case "htm":
        response_type = "text";
        break;
      case "json":
        response_type = "json";
        break;
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
        response_type = "blob";
        break;
      default:
        response_type = "blob";
        break;
    }
  }
  return response_type;
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
    if (!fetchInput.response_type) {
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

  async execute(input: I & FetchUrlTaskInput, executeConfig: IExecuteContext): Promise<O> {
    const url = this.inputToUrl(input);
    const response_type = guessResponseType(url, input);

    const fetchInput = {
      url: url,
      method: "GET",
      response_type: response_type,
    };

    return (await super.execute(fetchInput as I & FetchUrlTaskInput, executeConfig)) as O;
  }
}
