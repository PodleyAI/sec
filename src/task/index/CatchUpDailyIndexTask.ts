/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { unlink } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { isMissingRelationError } from "../../cli/queries/DbStatus";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import {
  DAILY_INDEX_CURSOR_ID,
  DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
} from "../../storage/processing/DailyIndexCursorSchema";
import { TypeSecDate } from "../../util/parseDate";
import { getHttpErrorStatus } from "../fetch/SecFetchJob";
import {
  dailyIndexCacheRelPath,
  DEFAULT_DAILY_INDEX_LOOKBACK,
  planIndexDays,
  todayEtYYYYdMMdDD,
} from "./dailyIndexDates";
import { dailyIndexWasPublished, isWeekendDate } from "./dailyIndexPublication";
import { FetchDailyIndexTask } from "./FetchDailyIndexTask";
import { StoreCikLastUpdatedTask } from "./StoreCikLastUpdatedTask";

/**
 * Whether a failed day's error means "EDGAR published no index for this day",
 * as opposed to "EDGAR refused this client".
 *
 * Both are 403 (some paths still 404), and the difference is the whole ballgame:
 * the unpublished branch advances `last_success` past the day, and nothing ever
 * goes back for it. A blocked client — rejected User-Agent, rate limit, an
 * egress EDGAR does not serve — would otherwise walk the cursor over every real
 * trading day in the lookback and report `success: true`.
 *
 * Weekends are free: EDGAR has never published one, so no request is made. A
 * weekday is the ambiguous case (Friday 2026-07-03, Independence Day observed,
 * is a genuine 403) and is settled against the quarter's own file listing,
 * which distinguishes the two directly. A probe that cannot answer throws,
 * because "unknown" must not be recorded as "unpublished".
 */
async function isUnpublishedDailyIndex(
  err: unknown,
  date: string,
  context: IExecuteContext
): Promise<boolean> {
  const status = getHttpErrorStatus(err);
  if (status !== 404 && status !== 403) return false;
  if (isWeekendDate(date)) return true;
  let published: boolean;
  try {
    published = await dailyIndexWasPublished(date, context);
  } catch (probeErr) {
    const detail = probeErr instanceof Error ? probeErr.message : String(probeErr);
    throw new Error(
      `EDGAR returned ${status} for the ${date} daily index and its quarter listing could ` +
        `not be read either (${detail}). That is the signature of a blocked client, not an ` +
        `unpublished day, so the cursor is left at ${date} rather than advanced past it. ` +
        `Check the SEC User-Agent and request rate, then re-run.`,
      { cause: err }
    );
  }
  if (published) {
    throw new Error(
      `EDGAR returned ${status} for the ${date} daily index, but its quarter listing names ` +
        `that day's master index — the day published and this client is being refused. ` +
        `Refusing to advance the cursor past ${date}. Check the SEC User-Agent and request ` +
        `rate, then re-run.`,
      { cause: err }
    );
  }
  return true;
}

export type CatchUpDailyIndexTaskInput = {
  readonly from?: string;
  readonly lookback?: number;
};

export type CatchUpDailyIndexTaskOutput = {
  readonly success: boolean;
  readonly fetched: number;
  readonly skipped404: number;
  readonly todayFetched: boolean;
  readonly lastSuccess: string | null;
};

export class CatchUpDailyIndexTask extends Task<
  CatchUpDailyIndexTaskInput,
  CatchUpDailyIndexTaskOutput
> {
  static readonly type = "CatchUpDailyIndexTask";
  static readonly category = "SEC";
  static readonly title = "Catch up daily indexes";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      from: Type.Optional(TypeSecDate()),
      lookback: Type.Optional(Type.Integer({ minimum: 1 })),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
      fetched: Type.Integer(),
      skipped404: Type.Integer(),
      todayFetched: Type.Boolean(),
      lastSuccess: Type.Union([TypeSecDate(), Type.Null()]),
    });
  }

  async execute(
    input: CatchUpDailyIndexTaskInput,
    context: IExecuteContext
  ): Promise<CatchUpDailyIndexTaskOutput> {
    const cursorRepo = globalServiceRegistry.get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN);
    const cikLastUpdateRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);

    let cursor;
    try {
      cursor = await cursorRepo.get({ id: DAILY_INDEX_CURSOR_ID });
    } catch (err) {
      if (isMissingRelationError(err)) {
        throw new Error(
          "daily_index_cursor table is missing. Run `sec db setup` before the first `sec sync`."
        );
      }
      throw err;
    }

    let seed: string | undefined;
    if (!cursor) {
      const rows =
        (await cikLastUpdateRepo.getAll({
          orderBy: [{ column: "last_update", direction: "DESC" }],
          limit: 1,
        })) ?? [];
      seed = rows[0]?.last_update;
    }

    const today = todayEtYYYYdMMdDD();
    const plan = planIndexDays({
      lastSuccess: cursor?.last_success,
      fromOverride: input.from,
      seed,
      today,
      lookback: input.lookback ?? DEFAULT_DAILY_INDEX_LOOKBACK,
    });

    if (isDryRun()) {
      console.log(`Would fetch completed [${plan.completed.join(", ")}], today ${plan.today}`);
      return {
        success: true,
        fetched: 0,
        skipped404: 0,
        todayFetched: false,
        lastSuccess: cursor?.last_success ?? null,
      };
    }

    const rawFolder = globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)
      ? globalServiceRegistry.get(SEC_RAW_DATA_FOLDER)
      : undefined;

    let fetched = 0;
    let skipped404 = 0;
    let lastSuccess: string | null = cursor?.last_success ?? null;

    const unlinkCacheFile = async (date: string): Promise<void> => {
      if (rawFolder === undefined) return;
      const cachePath = path.join(rawFolder, dailyIndexCacheRelPath(date));
      try {
        await unlink(cachePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    };

    const bypassCacheIfNeeded = async (date: string): Promise<void> => {
      if (!plan.bypassCache.includes(date)) return;
      await unlinkCacheFile(date);
    };

    // Owned per day and released per day: a cursor seeded from an old
    // `cik_last_update` plans one entry per calendar day since, so holding
    // every child for the whole of `execute()` is unbounded in the length of
    // the catch-up. `disown` is how a loop hands them back.
    const runDay = async (date: string): Promise<void> => {
      const fetchTask = context.own(new FetchDailyIndexTask());
      let updateList;
      try {
        ({ updateList } = await fetchTask.run({ date }));
      } finally {
        context.disown(fetchTask);
      }
      const storeTask = context.own(new StoreCikLastUpdatedTask());
      try {
        await storeTask.run({ updateList });
      } finally {
        context.disown(storeTask);
      }
    };

    for (const date of plan.completed) {
      await bypassCacheIfNeeded(date);
      try {
        await runDay(date);
        lastSuccess = date;
        await cursorRepo.put({ id: DAILY_INDEX_CURSOR_ID, last_success: date });
        fetched++;
      } catch (err) {
        if (await isUnpublishedDailyIndex(err, date, context)) {
          skipped404++;
          lastSuccess = date;
          await cursorRepo.put({ id: DAILY_INDEX_CURSOR_ID, last_success: date });
          continue;
        }
        throw err;
      }
    }

    let todayFetched = false;
    await unlinkCacheFile(plan.today);
    try {
      await runDay(plan.today);
      todayFetched = true;
      fetched++;
    } catch (err) {
      if (!(await isUnpublishedDailyIndex(err, plan.today, context))) {
        throw err;
      }
    }

    return {
      success: true,
      fetched,
      skipped404,
      todayFetched,
      lastSuccess,
    };
  }
}
