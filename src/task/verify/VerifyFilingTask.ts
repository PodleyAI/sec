/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { Task, type IExecuteContext } from "workglow";
import { S1_SECTIONS } from "../../sec/html/sectionVocabulary";
import { DocumentTreeSegmenter } from "../../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { parseEdgarHtmlWithTrace } from "../../sec/html/parseEdgarHtml";
import { buildChunkTrace } from "../../verify/chunkTrace";
import { loadFilingHtml } from "../../verify/loadFilingHtml";
import { buildParseTrace } from "../../verify/parseTrace";
import { buildSectionTrace, isExpectedContainment } from "../../verify/sectionTrace";
import type { TaskPorts } from "../taskPorts";

export const VERIFY_STAGES = ["parse", "sections", "chunks"] as const;
export type VerifyStage = (typeof VERIFY_STAGES)[number];

export interface VerifyFilingInput {
  readonly fixture?: string | undefined;
  readonly file?: string | undefined;
  readonly cik?: number | undefined;
  readonly accession?: string | undefined;
  readonly fetch?: boolean | undefined;
  readonly stages?: readonly string[] | undefined;
  /** Directory to write the full artifacts to. Omitted, only the summary is produced. */
  readonly out?: string | undefined;
}

/** One line of the parse summary, per drop reason the de-paginator used. */
export interface DropCount {
  readonly reason: string;
  readonly blocks: number;
  readonly chars: number;
}

export interface ParseSummary {
  readonly htmlChars: number;
  readonly blocks: number;
  readonly tables: number;
  readonly headings: number;
  readonly visibleChars: number;
  readonly emittedChars: number;
  readonly depaginatedChars: number;
  readonly lostChars: number;
  readonly lostRuns: number;
  readonly ignoredChars: number;
  readonly ignoredRuns: number;
  readonly coverage: number;
  readonly drops: readonly DropCount[];
  /** The largest losses, with what contained them — the ranked bug list. */
  readonly worstLost: readonly {
    readonly chars: number;
    readonly containedBy: string;
    readonly text: string;
  }[];
}

export interface SectionSummary {
  readonly usedLineScan: boolean;
  readonly resolved: number;
  readonly targets: number;
  readonly missing: readonly string[];
  /** A target whose heading is in the tree but which resolved to nothing. */
  readonly unresolvedWithHeading: readonly string[];
  readonly unexpectedContainments: readonly string[];
  readonly sizes: readonly {
    readonly name: string;
    readonly chars: number;
    /** Bounding span in the filing HTML, absent when a text fallback found it. */
    readonly source: { readonly start: number; readonly end: number } | undefined;
  }[];
  /** Sections resolved by a path with no mapping back to the source. */
  readonly withoutSource: readonly string[];
}

export interface ChunkSummary {
  readonly sectionChars: number;
  readonly chunks: number;
  readonly oversized: boolean;
  readonly reassembles: boolean;
  readonly splitTables: number;
  readonly carriedHeadingsNotVerbatim: number;
}

export interface VerifyFilingResult {
  readonly source: string;
  readonly sourceKind: string;
  readonly stages: readonly string[];
  readonly parse: ParseSummary | undefined;
  readonly sections: SectionSummary | undefined;
  readonly chunks: ChunkSummary | undefined;
  readonly artifacts: readonly { readonly stage: string; readonly path: string }[];
  readonly error: string | undefined;
}

const MAX_SUMMARY_LOSSES = 10;

/**
 * Produce the deterministic half of a verification trace for one filing: what
 * the HTML parser did with the document, what the segmenter cut out of it, and
 * how the risk section would be chunked.
 *
 * The task's OUTPUT is summaries only. The full traces — every block with its
 * source span, every dropped run — are written to `out` when asked, because a
 * single S-1 trace is tens of megabytes and the run's output travels through
 * the CLI event stream to anything watching it.
 */
export class VerifyFilingTask extends Task<
  TaskPorts<VerifyFilingInput>,
  TaskPorts<VerifyFilingResult>
> {
  static readonly type = "VerifyFilingTask";
  static readonly category = "SEC";
  static readonly title = "Verify filing parse";
  static readonly description =
    "Accounts for what the HTML parser, segmenter and chunker did with one filing";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      fixture: Type.Optional(Type.String()),
      file: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      accession: Type.Optional(Type.String()),
      fetch: Type.Optional(Type.Boolean()),
      stages: Type.Optional(Type.Array(Type.String())),
      out: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      source: Type.String(),
      sourceKind: Type.String(),
      stages: Type.Array(Type.String()),
      parse: Type.Optional(Type.Unknown()),
      sections: Type.Optional(Type.Unknown()),
      chunks: Type.Optional(Type.Unknown()),
      artifacts: Type.Array(Type.Unknown()),
      error: Type.Optional(Type.String()),
    });
  }

  async execute(
    input: VerifyFilingInput,
    context: IExecuteContext
  ): Promise<TaskPorts<VerifyFilingResult>> {
    const stages = (input.stages ?? VERIFY_STAGES).filter((s): s is VerifyStage =>
      (VERIFY_STAGES as readonly string[]).includes(s)
    );
    const artifacts: { stage: string; path: string }[] = [];
    const write = (stage: string, data: unknown): void => {
      if (input.out === undefined) return;
      mkdirSync(input.out, { recursive: true });
      const path = join(input.out, `${stage}.json`);
      writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
      artifacts.push({ stage, path });
    };

    let source;
    try {
      source = await loadFilingHtml(
        {
          fixture: input.fixture,
          file: input.file,
          cik: input.cik,
          accession: input.accession,
          allowFetch: input.fetch,
        },
        context
      );
    } catch (err) {
      // Reported as an output port, not thrown: on a TTY the workflow renderer
      // turns a throw into process.exit(1) before the command can print it.
      return {
        source: "",
        sourceKind: "",
        stages,
        parse: undefined,
        sections: undefined,
        chunks: undefined,
        artifacts: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    await context.updateProgress(10, "Parsing");
    const parsed = parseEdgarHtmlWithTrace(source.html, source.label);
    let parse: ParseSummary | undefined;
    if (stages.includes("parse")) {
      // Built only for the stage that reads it. `buildParseTrace` runs the
      // coverage measurement, which loads the filing into cheerio a SECOND time
      // (`visibleTextRuns`) and sweeps every visible run against every block —
      // seconds of work on a multi-megabyte filing, and none of it is what
      // `verify sections` or `verify chunks` were asked for.
      const parseTrace = buildParseTrace(source.html, source.label, parsed);
      write("parse", parseTrace);
      const drops = new Map<string, { blocks: number; chars: number }>();
      for (const d of parseTrace.dropped) {
        const e = drops.get(d.reason) ?? { blocks: 0, chars: 0 };
        e.blocks += 1;
        e.chars += d.text.length;
        drops.set(d.reason, e);
      }
      const c = parseTrace.coverage;
      parse = {
        htmlChars: parseTrace.htmlLength,
        blocks: parseTrace.blocks.length,
        tables: parseTrace.blocks.filter((b) => b.type === "table").length,
        headings: parseTrace.blocks.filter((b) => b.type === "heading").length,
        visibleChars: c.visibleChars,
        emittedChars: c.emittedChars,
        depaginatedChars: c.depaginatedChars,
        lostChars: c.lostChars,
        lostRuns: c.lostRuns,
        ignoredChars: c.ignoredChars,
        ignoredRuns: c.ignoredRuns,
        coverage: c.ratio,
        drops: [...drops].map(([reason, v]) => ({ reason, ...v })),
        worstLost: c.worstLost.slice(0, MAX_SUMMARY_LOSSES).map((l) => ({
          chars: l.text.length,
          containedBy: l.containedBy?.type ?? "(not inside any block)",
          text: l.text.slice(0, 160),
        })),
      };
    }

    let sections: SectionSummary | undefined;
    let chunks: ChunkSummary | undefined;
    if (stages.includes("sections") || stages.includes("chunks")) {
      await context.updateProgress(50, "Segmenting");
      const segmentation = new DocumentTreeSegmenter().segmentDocument(
        parsed.doc,
        parsed.sourceByNodeId
      );
      const sectionTrace = buildSectionTrace(parsed.doc, segmentation);
      if (stages.includes("sections")) {
        write("sections", sectionTrace);
        const resolved = sectionTrace.sections.filter((s) => s.resolved);
        sections = {
          usedLineScan: sectionTrace.usedLineScan,
          resolved: resolved.length,
          targets: sectionTrace.sections.length,
          missing: sectionTrace.sections.filter((s) => !s.resolved).map((s) => s.name),
          unresolvedWithHeading: [...sectionTrace.unresolvedWithHeading],
          unexpectedContainments: resolved.flatMap((s) =>
            s.contains
              .filter((inner) => !isExpectedContainment(s.name, inner))
              .map((inner) => `${s.name} contains ${inner}`)
          ),
          sizes: resolved.map((s) => ({ name: s.name, chars: s.chars, source: s.source })),
          withoutSource: resolved.filter((s) => s.source === undefined).map((s) => s.name),
        };
      }
      if (stages.includes("chunks")) {
        await context.updateProgress(80, "Chunking");
        const risk = segmentation.sections.find((s) => s.name === S1_SECTIONS.RISK_FACTORS);
        if (risk !== undefined) {
          const chunkTrace = buildChunkTrace(risk.text);
          write("chunks", chunkTrace);
          chunks = {
            sectionChars: chunkTrace.sectionChars,
            chunks: chunkTrace.chunks.length,
            oversized: chunkTrace.oversized,
            reassembles: chunkTrace.reassembles,
            splitTables: chunkTrace.splitTables,
            carriedHeadingsNotVerbatim: chunkTrace.chunks.filter((c) => !c.carriedHeadingVerbatim)
              .length,
          };
        }
      }
    }

    return {
      source: source.label,
      sourceKind: source.kind,
      stages,
      parse,
      sections,
      chunks,
      artifacts,
      error: undefined,
    };
  }
}
