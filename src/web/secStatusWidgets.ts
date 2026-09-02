/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebStatusWidget, type WebStatusItem } from "@workglow/cli";
import { globalServiceRegistry } from "workglow";
import { getDbStatus } from "../cli/queries/DbStatus";
import { getVersionStatus } from "../cli/queries/VersionStatus";
import { SecFetchMaxConcurrent, SecFetchMaxPerSec } from "../config/Constants";
import { SEC_DB_TYPE } from "../config/tokens";
import { readSecFetchPauseUntil } from "../task/fetch/secFetchThrottle";
import { closeAfterStats } from "./closeAfterStats";
import { cachedRead, readPendingDeadLetterCounts } from "./secWebReads";

/**
 * The rail: what an operator checks before starting work, and would otherwise
 * check by running three commands.
 *
 * Each widget answers on its own; one that cannot is dropped rather than
 * failing the rail, which matters because these read a database that may not be
 * set up yet — `sec db setup` is itself a command you would run from here.
 */

const source = "@workglow/sec";

/**
 * Whether the configured backend is Postgres.
 *
 * Read from the registry rather than the environment, because the answer
 * decides what the throttle line is allowed to claim: only the Postgres
 * limiter storage is shared between this process and the runs it spawns.
 */
function isPostgres(): boolean {
  return (
    globalServiceRegistry.has(SEC_DB_TYPE) && globalServiceRegistry.get(SEC_DB_TYPE) === "postgres"
  );
}

function humanDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/**
 * The EDGAR fetch budget, and whether it is currently paused.
 *
 * The pause is a cluster sentinel under Postgres and an in-process value under
 * SQLite — and the console runs every command as a CHILD process, so under
 * SQLite the server genuinely cannot see a cooldown a run is sitting in. It
 * says that rather than reporting "clear", which would be a claim about a
 * process it has no window into.
 */
async function readFetchStatus(): Promise<readonly WebStatusItem[]> {
  const items: WebStatusItem[] = [
    { kind: "text", label: "rate", value: `${SecFetchMaxPerSec}/s` },
    { kind: "text", label: "in flight", value: `max ${SecFetchMaxConcurrent}` },
  ];
  if (!isPostgres()) {
    items.push({ kind: "text", label: "throttle", value: "per-process (sqlite)", tone: "idle" });
    return items;
  }
  const until = await readSecFetchPauseUntil();
  const remaining = until - Date.now();
  items.push(
    remaining > 0
      ? {
          kind: "text",
          label: "throttle",
          value: `cooling ${humanDuration(remaining)}`,
          tone: "warn",
        }
      : { kind: "text", label: "throttle", value: "clear", tone: "ok" }
  );
  return items;
}

/** Which database, and how much is in it. */
async function readDbStatus(): Promise<readonly WebStatusItem[]> {
  const backend = isPostgres() ? "postgres" : "sqlite";
  const status = await cachedRead("db-status", () => getDbStatus());
  return [
    { kind: "text", label: "backend", value: backend, tone: "ok" },
    {
      kind: "text",
      label: "entities",
      value: status.entityCount.toLocaleString("en-US"),
      tone: status.entityCount === 0 ? "warn" : undefined,
    },
    { kind: "text", label: "filings", value: status.filingCount.toLocaleString("en-US") },
    {
      kind: "text",
      label: "extractor runs",
      value: status.extractorRuns.toLocaleString("en-US"),
      // Postgres counts are catalog estimates that lag recent writes; saying so
      // is the difference between a number and a number you can act on.
      ...(status.estimated ? { tone: "idle" as const } : {}),
    },
  ];
}

/** The worklist: what failed and is waiting for a retry or a fix. */
async function readDeadLetters(): Promise<readonly WebStatusItem[]> {
  const counts = await readPendingDeadLetterCounts();
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return [{ kind: "text", label: "pending", value: "none", tone: "ok" }];
  }
  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return [
    { kind: "text", label: "pending", value: total.toLocaleString("en-US"), tone: "warn" },
    ...worst.map(([extractor, waiting]): WebStatusItem => ({
      kind: "text",
      label: extractor,
      value: waiting.toLocaleString("en-US"),
    })),
  ];
}

/**
 * Open dev cycles.
 *
 * A component with a `next` slot is mid-ceremony, and forgetting one is how a
 * backfill runs under a version nobody meant to promote — so the rail names
 * them rather than reporting a count of components nobody is asking about.
 */
async function readVersionSlots(): Promise<readonly WebStatusItem[]> {
  const rows = await cachedRead("version-status", () => getVersionStatus());
  const open = rows.filter((row) => row.next !== "—");
  if (open.length === 0) {
    return [{ kind: "text", label: "dev cycles", value: "none open", tone: "ok" }];
  }
  return open.slice(0, 6).map((row): WebStatusItem => ({
    kind: "text",
    label: `${row.component_id}`,
    value: `${row.current} -> ${row.next}`,
    tone: row.next_coverage_complete ? "ok" : "warn",
  }));
}

export function registerSecStatusWidgets(): void {
  registerWebStatusWidget({
    id: "sec.fetch",
    title: "EDGAR fetch",
    source,
    read: () => closeAfterStats(readFetchStatus),
  });
  registerWebStatusWidget({
    id: "sec.db",
    title: "Database",
    source,
    read: () => closeAfterStats(readDbStatus),
  });
  registerWebStatusWidget({
    id: "sec.deadLetters",
    title: "Dead letters",
    source,
    read: () => closeAfterStats(readDeadLetters),
  });
  registerWebStatusWidget({
    id: "sec.versions",
    title: "Dev cycles",
    source,
    read: () => closeAfterStats(readVersionSlots),
  });
}
