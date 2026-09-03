/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { ADV_ADVISER_REPOSITORY_TOKEN, type AdvAdviser } from "../../storage/adv/AdvAdviserSchema";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import { FILING_SECTION_REPOSITORY_TOKEN } from "../../storage/document/FilingSectionSchema";
import { CIK_NAME_REPOSITORY_TOKEN } from "../../storage/entity/CikNameSchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import {
  DAILY_INDEX_CURSOR_ID,
  DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
} from "../../storage/processing/DailyIndexCursorSchema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { XBRL_FACT_REPOSITORY_TOKEN } from "../../storage/xbrl/XbrlFactSchema";
import { todayEtYYYYdMMdDD } from "../../task/index/dailyIndexDates";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE, SEC_PG_DATABASE } from "../../config/tokens";
import { isMissingRelationError } from "./DbStatus";

/** One line of the map: a stage, what is in it, and what advances it. */
export interface PipelineStage {
  readonly id: string;
  /** What the row is called, e.g. `companies`. */
  readonly label: string;
  /** The counts, already phrased — `812,043 known · 1,204 fetched`. */
  readonly summary: string;
  /** The single command that advances this stage, or undefined when none does. */
  readonly advance: string | undefined;
  /** True when the stage holds nothing yet. */
  readonly empty: boolean;
}

export interface PipelineStatus {
  readonly configured: boolean;
  readonly backend: string;
  /** Where the data lives — a SQLite path, or the Postgres database name. */
  readonly location: string | undefined;
  readonly stages: readonly PipelineStage[];
  /** Completed ET days the daily index is behind, or undefined when unstarted. */
  readonly indexDaysBehind: number | undefined;
  /** The one thing most worth doing next, or undefined when nothing stands out. */
  readonly headline: string | undefined;
}

const n = (value: number): string => value.toLocaleString("en-US");

/** Where the data lives, phrased for the header line. */
function describeLocation(backend: string): string | undefined {
  if (backend === "postgres") {
    return globalServiceRegistry.has(SEC_PG_DATABASE)
      ? globalServiceRegistry.get(SEC_PG_DATABASE)
      : undefined;
  }
  if (!globalServiceRegistry.has(SEC_DB_FOLDER)) return undefined;
  const folder = globalServiceRegistry.get(SEC_DB_FOLDER);
  const name = globalServiceRegistry.has(SEC_DB_NAME)
    ? globalServiceRegistry.get(SEC_DB_NAME)
    : "edgar";
  return `${folder}/${name}.sqlite`;
}

/**
 * A table's row count, or 0 for a table `db setup` has not created.
 *
 * `status` is what a reader runs when something is wrong, so a database missing
 * a table has to produce a report saying so rather than a stack trace.
 */
async function countOrZero(
  token: Parameters<typeof globalServiceRegistry.get>[0]
): Promise<number> {
  try {
    const repo = globalServiceRegistry.get(token) as { size(): Promise<number> };
    return await repo.size();
  } catch (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }
}

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

async function latestAdvSnapshot(): Promise<string | undefined> {
  try {
    const repo = globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN);
    let newest: string | undefined;
    for await (const row of repo.records(1000) as AsyncIterable<AdvAdviser>) {
      if (newest === undefined || row.snapshot > newest) newest = row.snapshot;
    }
    return newest;
  } catch (error) {
    if (isMissingRelationError(error)) return undefined;
    throw error;
  }
}

/**
 * Where the pipeline stands, as one screen.
 *
 * Every row carries the command that advances it, and it is the same string a
 * `suggest()` call would print — the map and the suggestions speak one
 * vocabulary, so a reader who has seen either can follow the other.
 */
export async function getPipelineStatus(now: Date = new Date()): Promise<PipelineStatus> {
  const [ciks, entities, filings, facts, documents, sections, xbrl, processedFacts, advisers] =
    await Promise.all([
      countOrZero(CIK_NAME_REPOSITORY_TOKEN),
      countOrZero(ENTITY_REPOSITORY_TOKEN),
      countOrZero(FILING_REPOSITORY_TOKEN),
      countOrZero(COMPANY_FACTS_REPOSITORY_TOKEN),
      countOrZero(FILING_DOCUMENT_REPOSITORY_TOKEN),
      countOrZero(FILING_SECTION_REPOSITORY_TOKEN),
      countOrZero(XBRL_FACT_REPOSITORY_TOKEN),
      countOrZero(PROCESSED_FACTS_REPOSITORY_TOKEN),
      countOrZero(ADV_ADVISER_REPOSITORY_TOKEN),
    ]);

  let indexDaysBehind: number | undefined;
  try {
    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    if (cursor !== undefined) {
      // Yesterday is the newest COMPLETED day, so a cursor there is current.
      const yesterday = todayEtYYYYdMMdDD(new Date(now.getTime() - 86_400_000));
      indexDaysBehind = daysBetween(cursor.last_success, yesterday);
    }
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }

  const snapshot = advisers > 0 ? await latestAdvSnapshot() : undefined;

  const stages: PipelineStage[] = [
    {
      id: "companies",
      label: "companies",
      summary: ciks === 0 && entities === 0 ? "none" : `${n(ciks)} known · ${n(entities)} fetched`,
      advance: ciks === 0 ? "sec load download ciks" : "sec get <company>",
      empty: ciks === 0 && entities === 0,
    },
    {
      id: "filings",
      label: "filings",
      summary: filings === 0 ? "none" : n(filings),
      advance: filings === 0 ? "sec update index" : undefined,
      empty: filings === 0,
    },
    {
      id: "facts",
      label: "facts",
      summary: facts === 0 ? "none" : `${n(facts)} across ${n(processedFacts)} companies`,
      advance: "sec update facts",
      empty: facts === 0,
    },
    {
      id: "documents",
      label: "documents",
      summary: documents === 0 ? "none" : `${n(documents)} documents → ${n(sections)} sections`,
      advance: "sec update documents",
      empty: documents === 0,
    },
    {
      id: "xbrl",
      label: "xbrl",
      summary: xbrl === 0 ? "none" : `${n(xbrl)} as-filed facts`,
      // Written by the documents sweep, so it has no command of its own.
      advance: undefined,
      empty: xbrl === 0,
    },
    {
      id: "advisers",
      label: "advisers",
      summary:
        advisers === 0 ? "none" : `${n(advisers)}${snapshot === undefined ? "" : ` (${snapshot})`}`,
      advance: "sec update adv",
      empty: advisers === 0,
    },
  ];

  // One thing to do next, chosen by what is furthest behind rather than by
  // listing every stage's command: a screen where every line ends in a command
  // tells a reader nothing about which one to run.
  let headline: string | undefined;
  if (ciks === 0 && filings === 0) {
    headline = "sec load download ciks";
  } else if (indexDaysBehind !== undefined && indexDaysBehind > 1) {
    headline = "sec update";
  } else if (filings > 0 && documents === 0) {
    headline = "sec update documents";
  }

  const backend = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : "sqlite";
  return {
    configured: true,
    backend,
    location: describeLocation(backend),
    stages,
    indexDaysBehind,
    headline,
  };
}
