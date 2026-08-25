/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { decode } from "html-entities";
import type { SourceSpan } from "../sec/html/types";
import { visibleTextRuns } from "./visibleText";

/** A span with the text whatever produced it ended up carrying. */
export interface SpannedText {
  readonly source: SourceSpan;
  readonly text: string;
}

/**
 * Letters and digits only.
 *
 * The two sides of this comparison went through different pipelines — one is
 * raw text nodes, the other has been entity-decoded, whitespace-collapsed,
 * joined across DOM nodes and, for a table, re-rendered as GFM with pipes and
 * padding inserted. Every difference between them is punctuation or spacing,
 * so removing both leaves exactly the content question: did these characters
 * survive?
 */
export function alphanumeric(s: string): string {
  return decode(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** What became of one run of visible text. */
export const RUN_VERDICTS = ["emitted", "depaginated", "lost", "ignored"] as const;
export type RunVerdict = (typeof RUN_VERDICTS)[number];

export interface LostRun {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /**
   * The block whose span contains this run, when one does. A lost run inside a
   * block is text the block was built from and then failed to carry — a cell
   * dropped from a table, a footnote absorbed by a heading. A lost run inside
   * nothing was never reached by the walk at all. The two have different fixes.
   */
  readonly containedBy: { readonly type: string; readonly source: SourceSpan } | undefined;
}

export interface CoverageReport {
  readonly visibleRuns: number;
  readonly visibleChars: number;
  readonly emittedChars: number;
  readonly depaginatedChars: number;
  readonly lostChars: number;
  /**
   * Runs carrying no letter or digit — a rule of underscores, a cell of
   * zero-width spaces, a lone bullet. Excluded from the ratio entirely rather
   * than counted as loss: the comparison is on alphanumerics, so such a run can
   * never be matched and would be reported lost forever however well the parser
   * did. They are 22.4% of all runs across the committed corpus, and reporting
   * them as loss put a permanent 65,304-character floor under the number.
   *
   * Counted here rather than dropped silently, so the denominator stays
   * auditable.
   */
  readonly ignoredRuns: number;
  readonly ignoredChars: number;
  /** Emitted / visible. De-paginated text counts against it: it is content the filing carried. */
  readonly ratio: number;
  readonly lostRuns: number;
  readonly worstLost: readonly LostRun[];
}

/** How many lost runs a report lists before it just counts the rest. */
export const MAX_REPORTED_LOST = 50;

interface Container extends SpannedText {
  readonly type: string;
}

/**
 * Innermost container of each visible run, by a single ordered sweep.
 *
 * Block spans nest: a table's span covers every cell inside it, and a table
 * that had its caption row peeled into a paragraph covers that paragraph too.
 * Asking only whether a run falls inside *some* span therefore answers yes for
 * every run in the filing — which is how the first version of this measurement
 * reported 100.00% coverage over 31.5M characters and said nothing at all.
 * The innermost container is the one whose text the run must actually appear
 * in.
 */
function sweep(
  runs: readonly { start: number; end: number; text: string }[],
  containers: readonly Container[],
  onRun: (runIndex: number, container: Container | undefined) => void
): void {
  const sorted = [...containers].sort(
    (a, b) => a.source.start - b.source.start || b.source.end - a.source.end
  );
  const open: Container[] = [];
  let next = 0;
  runs.forEach((run, index) => {
    while (next < sorted.length && sorted[next]!.source.start <= run.start) {
      open.push(sorted[next]!);
      next++;
    }
    while (open.length > 0 && open[open.length - 1]!.source.end <= run.start) open.pop();
    // Only the innermost still-open container can contain the run; an ancestor
    // that ended earlier was popped, and one that ends later is below it here.
    const top = open[open.length - 1];
    onRun(index, top !== undefined && top.source.end >= run.end ? top : undefined);
  });
}

/**
 * Account for every character of visible text in `html`.
 *
 * Three outcomes, and only the third is a defect: the text reached a block the
 * parser emitted, or it reached a block the de-paginator then removed as page
 * furniture, or it reached neither and is gone with no record.
 */
export function measureCoverage(
  html: string,
  emitted: readonly Container[],
  depaginated: readonly Container[]
): CoverageReport {
  const runs = visibleTextRuns(html);
  const needles = runs.map((run) => alphanumeric(run.text));
  const verdicts: RunVerdict[] = needles.map((needle) =>
    needle.length === 0 ? "ignored" : "lost"
  );
  const containers: (Container | undefined)[] = new Array(runs.length).fill(undefined);

  const claim = (pool: readonly Container[], verdict: RunVerdict, record: boolean): void => {
    const texts = new Map<Container, string>();
    sweep(runs, pool, (index, container) => {
      if (container === undefined) return;
      if (record && containers[index] === undefined) containers[index] = container;
      if (verdicts[index] !== "lost") return;
      let haystack = texts.get(container);
      if (haystack === undefined) {
        haystack = alphanumeric(container.text);
        texts.set(container, haystack);
      }
      if (haystack.includes(needles[index]!)) verdicts[index] = verdict;
    });
  };

  claim(emitted, "emitted", true);
  claim(depaginated, "depaginated", false);

  let visibleChars = 0;
  let emittedChars = 0;
  let depaginatedChars = 0;
  let lostChars = 0;
  let ignoredRuns = 0;
  let ignoredChars = 0;
  const lost: LostRun[] = [];
  runs.forEach((run, index) => {
    const n = run.text.length;
    if (verdicts[index] === "ignored") {
      ignoredRuns += 1;
      ignoredChars += n;
      return;
    }
    visibleChars += n;
    if (verdicts[index] === "emitted") emittedChars += n;
    else if (verdicts[index] === "depaginated") depaginatedChars += n;
    else {
      lostChars += n;
      const container = containers[index];
      lost.push({
        start: run.start,
        end: run.end,
        text: run.text,
        containedBy:
          container === undefined ? undefined : { type: container.type, source: container.source },
      });
    }
  });

  return {
    visibleRuns: runs.length - ignoredRuns,
    visibleChars,
    emittedChars,
    depaginatedChars,
    lostChars,
    ignoredRuns,
    ignoredChars,
    ratio: visibleChars === 0 ? 1 : emittedChars / visibleChars,
    lostRuns: lost.length,
    worstLost: [...lost].sort((a, b) => b.text.length - a.text.length).slice(0, MAX_REPORTED_LOST),
  };
}
