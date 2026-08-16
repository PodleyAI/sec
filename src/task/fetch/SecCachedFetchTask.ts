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

const RESPONSE_TYPES = ["stream", "text", "json", "blob", "arraybuffer"] as const;

export type response_type = (typeof RESPONSE_TYPES)[number];
export interface SecCachedFetchTaskInput {
  cik: number;
  date?: YYYYdMMdDD;
  response_type?: response_type;
}

/**
 * True for any type FetchUrlTask accepts. `"stream"` is included: it
 * materializes no derived port, and {@link SecFetchFileOutputCache} sinks it
 * through `saveOutputStreamPort` to the same path a materializing fetch of the
 * same document would write — so a caller that only wants the bytes on disk
 * (`sec spac download`) can ask for it and the cache still fills.
 */
function isResponseType(value: unknown): value is response_type {
  return (RESPONSE_TYPES as readonly unknown[]).includes(value);
}

/**
 * Resolves the response type for a request. A caller-supplied type is always
 * honored — including `"stream"` — and the URL extension only decides for a
 * caller that did not state one. `"stream"` is therefore never *guessed*:
 * materializing is the safe default for a parser-facing fetch, and asking for
 * bytes-only is an explicit decision about who reads the result.
 */
function guessResponseType(urlstr: string, input: FetchUrlTaskInput): response_type {
  if (isResponseType(input.response_type)) {
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

/**
 * True when a schema declares the `x-stream: "binary"` `body` port the cache's
 * streaming sink writes through. A subclass that narrows {@link
 * SecCachedFetchTask.outputSchema} to its own port shape drops that port, and
 * with it the sink — see the guard in the constructor.
 */
function declaresBinaryBodyPort(schema: unknown): boolean {
  const properties = (
    schema as { properties?: Record<string, { "x-stream"?: unknown } | undefined> } | undefined
  )?.properties;
  return properties?.body?.["x-stream"] === "binary";
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

  /**
   * FetchUrlTask's real output schema, not the `{}` this used to return.
   *
   * Which schema is declared here decides whether a cached fetch can stream at
   * all: the runner reads the OUTPUT schema to find the `x-stream: "binary"`
   * port, so an empty one meant `getBinaryRefSinksByPolicy` built no sink and
   * the cache file was written only by `saveOutput`, off the materialized
   * derived value. That was harmless while every fetch materialized
   * something — and silently fatal for `response_type: "stream"`, which
   * materializes nothing: no sink AND no derived value is no bytes anywhere,
   * so the download reported success and wrote no cache entry.
   *
   * ⚠️ A subclass that narrows this to its own port shape (as
   * `SecFetchSubmissionsTask` does, to publish the typed JSON it returns) drops
   * `body` and lands back in the no-sink case. That is fine for a fetch whose
   * `response_type` materializes a value — `saveOutput` still writes it — but
   * such a subclass must not ask for `"stream"`.
   *
   * The return type stays `any`, as it was: FetchUrlTask declares its schema as
   * a literal, so TypeScript's static-side variance rejects any narrowing
   * override outright, and that escape hatch is the only reason those
   * subclasses compile. What changed is the runtime value — the schema the
   * runner actually reads — not the typing.
   */
  static outputSchema(): any {
    return SecFetchTask.outputSchema();
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
    if (!isResponseType(fetchInput.response_type)) {
      const response_type = guessResponseType(this.inputToUrl(fetchInput as I), fetchInput);
      fetchInput.response_type = response_type;
      (this.runInputData as FetchUrlTaskInput).response_type = response_type;
    }

    // Enforce the hazard {@link SecCachedFetchTask.outputSchema} documents,
    // rather than leaving it to whoever reads that comment. `"stream"`
    // materializes no derived port, so the streaming sink is the ONLY writer —
    // and the runner only builds one for a schema declaring a binary `body`
    // port. A subclass that narrowed the schema away would report success and
    // write no cache entry, which is precisely the silent failure the schema
    // fix exists to remove. Checked only on the `"stream"` path, so nothing
    // else pays for evaluating the schema at construction time.
    if (fetchInput.response_type === "stream") {
      const ctor = this.constructor as typeof SecCachedFetchTask;
      if (!declaresBinaryBodyPort(ctor.outputSchema())) {
        throw new Error(
          `${ctor.type}: response_type "stream" requires a binary \`body\` output port for the ` +
            `cache sink to write through, and this task's outputSchema() declares none — the ` +
            `fetch would report success and write no cache entry. Ask for a materializing ` +
            `response_type instead.`
        );
      }
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
