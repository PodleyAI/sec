/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebStatusWidget, type WebStatusItem } from "@workglow/cli";
import { globalServiceRegistry } from "workglow";
import { getDbStatus } from "../cli/queries/DbStatus";
import { SecFetchMaxConcurrent, SecFetchMaxPerSec } from "../config/Constants";
import { SEC_DB_TYPE } from "../config/tokens";
import { readSecFetchPauseUntil } from "../task/fetch/secFetchThrottle";
import { closeAfterStats } from "./closeAfterStats";
import { cachedRead } from "./secWebReads";

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
      label: "documents",
      value: status.documentCount.toLocaleString("en-US"),
      // Postgres counts are catalog estimates that lag recent writes; saying so
      // is the difference between a number and a number you can act on.
      ...(status.estimated ? { tone: "idle" as const } : {}),
    },
  ];
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
}
