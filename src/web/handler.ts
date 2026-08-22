/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_DB_NAME, SEC_DB_TYPE } from "../config/tokens";
import { ENTITY_REPOSITORY_TOKEN } from "../storage/entity/EntitySchema";
import { isCandidateConfidence, loadCandidates } from "./data/candidates";
import {
  buildCompareTable,
  comparableExtractors,
  compareModels,
  type CompareResult,
} from "./data/compare";
import { loadDocumentPart, loadFilingDocument, type DocumentPart } from "./data/documents";
import { loadAccessionExtractions, type AccessionExtractions } from "./data/extractions";
import { currentSlotModels, MODEL_SLOTS, modelOptions, type ModelOverrides } from "./data/models";
import { loadSpacDetail } from "./data/spacDetail";
import { loadTimelineSteps } from "./data/steps";
import { renderCandidatesPage } from "./render/candidatesPage";
import { renderFilingPage } from "./render/filingPage";
import { renderIndexPage } from "./render/indexPage";
import { renderProcessPage } from "./render/processPage";
import { renderRunPage, renderRunsPage } from "./render/runsPage";
import { renderSpacPage } from "./render/spacPage";
import {
  enqueueCandidateRebuild,
  enqueueCompareRun,
  enqueueTimelineRun,
  type RunRecord,
  type RunRegistry,
} from "./runs";

/** A request reduced to what the router needs, so the handler is runtime-neutral. */
export interface WebRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  /** Parsed form body for POSTs; empty for GETs. */
  readonly form: URLSearchParams;
}

/**
 * Either a complete response, or a request to open the server-sent-event
 * stream. SSE is signalled rather than returned as a body because it outlives
 * the request, and only the runtime adapter can hold the socket open.
 */
export type WebResponse =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
    }
  | {
      readonly kind: "sse";
      /** Only events matching this filter are forwarded; both undefined means all. */
      readonly cik: number | undefined;
      readonly runId: string | undefined;
    };

function htmlResponse(body: string, status = 200): WebResponse {
  return {
    kind: "response",
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    body,
  };
}

function textResponse(body: string, status = 200): WebResponse {
  return {
    kind: "response",
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    body,
  };
}

function jsonResponse(value: unknown, status = 200): WebResponse {
  return {
    kind: "response",
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(value, null, 2),
  };
}

function redirect(location: string): WebResponse {
  return { kind: "response", status: 303, headers: { location }, body: "" };
}

function errorPage(message: string, status = 404): WebResponse {
  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>${status}</title>` +
      `<body style="font:14px system-ui;padding:2rem"><h1>${status}</h1><p>${message
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")}</p><p><a href="/">Back to overview</a></p>`,
    status
  );
}

function intParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** Long text panels the compare tab fetches on demand. */
const PROMPT_PARTS: ReadonlySet<string> = new Set(["prompt", "instructions", "schema", "section"]);

/** EDGAR accession numbers, dashed or bare. Anything else is not one. */
const ACCESSION_PATTERN = /^[A-Za-z0-9-]{1,25}$/;

/**
 * Parse a CIK from a path segment. Leading zeros are accepted because EDGAR
 * itself writes them both ways and a link copied from a filing index must not
 * 404.
 */
function parseCikSegment(segment: string): number | undefined {
  if (!/^\d{1,10}$/.test(segment)) return undefined;
  const value = Number(segment);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Model overrides from the process form.
 *
 * A free-text id fills every slot the picker left unchanged, which is what
 * "run this filing under model X" means when the operator does not want to
 * think about which of six slots the filing's sections read.
 */
export function overridesFromForm(form: URLSearchParams): {
  readonly overrides: ModelOverrides;
  readonly models: readonly string[];
} {
  const free = (form.get("model_free") ?? "").trim();
  const overrides: Record<string, string> = {};
  for (const slot of MODEL_SLOTS) {
    const chosen = (form.get(`model_${slot.id}`) ?? "").trim();
    if (chosen !== "") overrides[slot.id] = chosen;
    else if (free !== "") overrides[slot.id] = free;
  }
  return { overrides, models: [...new Set(Object.values(overrides))] };
}

/** Route one request. Pure apart from the reads and the runs it enqueues. */
export async function handleWebRequest(
  request: WebRequest,
  registry: RunRegistry
): Promise<WebResponse> {
  const { path } = request;

  if (path === "/events") {
    const cik = request.query.get("cik");
    const run = request.query.get("run");
    return {
      kind: "sse",
      cik: cik === null ? undefined : (parseCikSegment(cik) ?? undefined),
      runId: run === null || run === "" ? undefined : run,
    };
  }

  if (path === "/goto") {
    const cik = parseCikSegment((request.query.get("cik") ?? "").trim());
    if (cik === undefined) return errorPage("Not a CIK.", 400);
    return redirect(`/spac/${cik}`);
  }

  if (path === "/") {
    return htmlResponse(
      renderIndexPage({
        candidates: await loadCandidates({ limit: 0 }),
        slots: MODEL_SLOTS,
        slotModels: currentSlotModels(),
        runs: registry.list(),
        dbLabel: describeDatabase(),
      })
    );
  }

  if (path === "/candidates") {
    const confidenceRaw = (request.query.get("confidence") ?? "").trim();
    if (confidenceRaw !== "" && !isCandidateConfidence(confidenceRaw)) {
      return errorPage(`Unknown confidence tier "${confidenceRaw}".`, 400);
    }
    const data = await loadCandidates({
      confidence: confidenceRaw === "" ? undefined : confidenceRaw,
      search: request.query.get("q") ?? "",
      offset: intParam(request.query, "offset", 0),
      limit: intParam(request.query, "limit", 100),
    });
    return htmlResponse(renderCandidatesPage({ data, activeRun: activeRun(registry) }));
  }

  if (path === "/runs") {
    return htmlResponse(renderRunsPage(registry.list()));
  }

  const runMatch = /^\/runs\/([^/]+)$/.exec(path);
  if (runMatch) {
    const run = registry.get(decodeURIComponent(runMatch[1]!));
    if (run === undefined) return errorPage("No such run.");
    return htmlResponse(renderRunPage(run));
  }

  const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(path);
  if (cancelMatch && request.method === "POST") {
    const id = decodeURIComponent(cancelMatch[1]!);
    registry.cancel(id);
    return redirect(`/runs/${encodeURIComponent(id)}`);
  }

  if (path === "/api/candidates/rebuild" && request.method === "POST") {
    const run = enqueueCandidateRebuild(registry, {
      full: (request.form.get("full") ?? "") !== "",
    });
    return redirect(`/runs/${encodeURIComponent(run.id)}`);
  }

  if (path === "/api/process" && request.method === "POST") {
    const cik = parseCikSegment((request.form.get("cik") ?? "").trim());
    if (cik === undefined) return errorPage("Not a CIK.", 400);
    const { overrides, models } = overridesFromForm(request.form);
    const accession = (request.form.get("accession") ?? "").trim();
    if (accession !== "" && !ACCESSION_PATTERN.test(accession)) {
      return errorPage("Malformed accession number.", 400);
    }
    const mode = request.form.get("mode") ?? "";
    const run = enqueueTimelineRun(registry, {
      cik,
      // Pressing a step's Run button submits its accession, and that is a
      // request to run exactly that filing — including one that already
      // succeeded, which is the whole point of re-running under a new model.
      ...(accession !== "" ? { accessions: [accession] } : {}),
      ...(accession === "" && mode === "rebuild" ? { force: "all" } : {}),
      overrides,
      models,
    });
    return redirect(`/spac/${cik}/process#run-${encodeURIComponent(run.id)}`);
  }

  if (path === "/api/compare" && request.method === "POST") {
    const cik = parseCikSegment((request.form.get("cik") ?? "").trim());
    const accession = (request.form.get("accession") ?? "").trim();
    // Validated to the same shape the GET route enforces. The value reaches a
    // cache-path composition (guarded downstream by `assertInsideDir`, but the
    // guard is not the place to first learn the input was not an accession).
    if (cik === undefined || !ACCESSION_PATTERN.test(accession)) {
      return errorPage("Missing or malformed CIK / accession.", 400);
    }
    const models = [
      ...request.form.getAll("models"),
      ...(request.form.get("extra_models") ?? "").split(","),
    ]
      .map((m) => m.trim())
      .filter((m) => m !== "");
    const extractor = (request.form.get("extractor") ?? "").trim();
    const distinct = [...new Set(models)];
    // A preview calls no model, so it answers immediately and is rendered
    // inline. A comparison is a sequence of cloud calls over a section that can
    // run to 57k characters, so it goes on the queue and the page follows its
    // progress instead of holding the request open with nothing to show.
    if ((request.form.get("mode") ?? "") === "preview") {
      const preview = await compareModels({
        cik,
        accessionNumber: accession,
        extractor,
        models: distinct,
        previewOnly: true,
      });
      return renderFiling(cik, accession, "compare", preview, undefined);
    }
    if (distinct.length === 0) {
      const empty = await compareModels({
        cik,
        accessionNumber: accession,
        extractor,
        models: [],
      });
      return renderFiling(cik, accession, "compare", empty, undefined);
    }
    const run = enqueueCompareRun(registry, {
      cik,
      accessionNumber: accession,
      extractor,
      models: distinct,
    });
    return redirect(
      `/spac/${cik}/filing/${encodeURIComponent(accession)}?tab=compare&run=${encodeURIComponent(run.id)}`
    );
  }

  const spacMatch = /^\/spac\/(\d{1,10})$/.exec(path);
  if (spacMatch) {
    const cik = parseCikSegment(spacMatch[1]!);
    if (cik === undefined) return errorPage("Not a CIK.", 400);
    return htmlResponse(renderSpacPage(await loadSpacDetail(cik)));
  }

  const processMatch = /^\/spac\/(\d{1,10})\/process$/.exec(path);
  if (processMatch) {
    const cik = parseCikSegment(processMatch[1]!);
    if (cik === undefined) return errorPage("Not a CIK.", 400);
    const [steps, name] = await Promise.all([loadTimelineSteps(cik), issuerName(cik)]);
    return htmlResponse(
      renderProcessPage({
        steps,
        name,
        options: modelOptions(),
        currentModels: currentSlotModels(),
        runs: registry.list().filter((r) => r.cik === cik),
        activeRun: activeRun(registry),
      })
    );
  }

  const filingMatch = /^\/spac\/(\d{1,10})\/filing\/([^/]+)$/.exec(path);
  if (filingMatch) {
    const cik = parseCikSegment(filingMatch[1]!);
    if (cik === undefined) return errorPage("Not a CIK.", 400);
    const accession = decodeURIComponent(filingMatch[2]!);
    if (!ACCESSION_PATTERN.test(accession)) return errorPage("Not an accession number.", 400);
    const tabRaw = request.query.get("tab") ?? "document";
    const tab = tabRaw === "extractions" || tabRaw === "compare" ? tabRaw : "document";
    // A comparison the page is following: its answer lives on the run, since
    // nothing else records it.
    const runId = (request.query.get("run") ?? "").trim();
    const run = runId === "" ? undefined : registry.get(runId);
    return renderFiling(cik, accession, tab, run?.result as CompareResult | undefined, run);
  }

  // One panel's text, fetched when the reader opens it — see `loadDocumentPart`.
  if (path === "/api/document") {
    const cik = parseCikSegment((request.query.get("cik") ?? "").trim());
    const accession = (request.query.get("accession") ?? "").trim();
    const partRaw = request.query.get("part") ?? "";
    if (cik === undefined || !ACCESSION_PATTERN.test(accession)) {
      return textResponse("missing or malformed CIK / accession", 400);
    }
    if (partRaw !== "markdown" && partRaw !== "raw" && partRaw !== "section") {
      return textResponse(`unknown document part "${partRaw}"`, 400);
    }
    const result = await loadDocumentPart({
      cik,
      accessionNumber: accession,
      part: partRaw as DocumentPart,
      name: request.query.get("name") ?? undefined,
      full: (request.query.get("full") ?? "") !== "",
    });
    // Plain text, not JSON: the browser drops it straight into a `<pre>`, and a
    // 3.2 MB source re-encoded as a JSON string is the payload this exists to
    // avoid paying twice.
    return result.error === "" ? textResponse(result.text) : textResponse(result.error, 404);
  }

  // The compare tab's long text, fetched when a panel is opened. Recomputed
  // from the memoized conversion rather than read off a run, so it works for a
  // preview too — and with the nonce off (the default) the prompt is a pure
  // function of the extractor and the cached document, so it is the same bytes
  // the run sent.
  if (path === "/api/prompt") {
    const cik = parseCikSegment((request.query.get("cik") ?? "").trim());
    const accession = (request.query.get("accession") ?? "").trim();
    const partRaw = request.query.get("part") ?? "";
    if (cik === undefined || !ACCESSION_PATTERN.test(accession)) {
      return textResponse("missing or malformed CIK / accession", 400);
    }
    if (!PROMPT_PARTS.has(partRaw)) return textResponse(`unknown prompt part "${partRaw}"`, 400);
    const built = await compareModels({
      cik,
      accessionNumber: accession,
      extractor: (request.query.get("extractor") ?? "").trim(),
      models: [],
      previewOnly: true,
    });
    if (built.error !== "") return textResponse(built.error, 404);
    const text =
      partRaw === "prompt"
        ? built.prompt
        : partRaw === "instructions"
          ? built.instructions
          : partRaw === "schema"
            ? built.schema
            : built.sectionText;
    return textResponse(text);
  }

  // One model's rows from a finished comparison. They live only on the run.
  if (path === "/api/compare-rows") {
    const run = registry.get((request.query.get("run") ?? "").trim());
    const model = (request.query.get("model") ?? "").trim();
    const result = run?.result as CompareResult | undefined;
    if (result === undefined) return textResponse("no such comparison", 404);
    const modelRun = result.runs.find((r) => r.model === model);
    if (modelRun === undefined) return textResponse(`no run for model "${model}"`, 404);
    return textResponse(JSON.stringify(modelRun.rows, null, 2));
  }

  if (path === "/api/state") {
    return jsonResponse({ runs: registry.list() });
  }

  return errorPage("No such page.");
}

/** Shared by the filing route and the compare POST, which renders the same page. */
async function renderFiling(
  cik: number,
  accessionNumber: string,
  tab: "document" | "extractions" | "compare",
  compare: CompareResult | undefined,
  compareRun: RunRecord | undefined
): Promise<WebResponse> {
  const [doc, extractions, name] = await Promise.all([
    // The document tab is the only one that needs the converted text, and
    // converting a multi-megabyte prospectus is seconds of work — so the other
    // tabs ask for the cache status only.
    loadFilingDocument({ cik, accessionNumber, includeText: tab === "document" }),
    // And only the extractions tab RENDERS them. That sweep asks every
    // accession-keyed table for this filing's rows, and fifteen of them carry
    // no index leading on `accession_number` — so on a real database it is
    // fifteen full table scans. Paying that on the document tab bought
    // nothing: the result was loaded and then dropped.
    tab === "extractions"
      ? loadAccessionExtractions(accessionNumber)
      : emptyExtractions(accessionNumber),
    issuerName(cik),
  ]);
  return htmlResponse(
    renderFilingPage({
      cik,
      accessionNumber,
      name,
      doc,
      extractions,
      extractors: comparableExtractors(),
      options: modelOptions(),
      compare,
      compareRun,
      compareTable: compare === undefined ? undefined : buildCompareTable(compare),
      tab,
    })
  );
}

/** The shape the filing page expects when a tab does not display extractions. */
function emptyExtractions(accessionNumber: string): AccessionExtractions {
  return { accessionNumber, runs: [], deadLetters: [], tables: [], emptyTables: [] };
}

function activeRun(registry: RunRegistry) {
  return registry.list().find((r) => r.status === "running" || r.status === "queued");
}

async function issuerName(cik: number): Promise<string> {
  try {
    const rows = (await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).query({ cik })) ?? [];
    return rows[0]?.name ?? `CIK ${cik}`;
  } catch {
    return `CIK ${cik}`;
  }
}

/** Which database the page is reading, so a reader knows what they are looking at. */
function describeDatabase(): string {
  const type = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : "unknown";
  const name = globalServiceRegistry.has(SEC_DB_NAME)
    ? globalServiceRegistry.get(SEC_DB_NAME)
    : "unknown";
  return `${type} · ${name}`;
}
