/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { unlink } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task } from "workglow";
import { isMissingRelationError } from "../../cli/queries/DbStatus";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import {
  DAILY_INDEX_CURSOR_ID,
  DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
} from "../../storage/processing/DailyIndexCursorSchema";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { TypeSecDate } from "../../util/parseDate";
import { getHttpErrorStatus } from "../fetch/SecFetchJob";
import {
  dailyIndexCacheRelPath,
  DEFAULT_DAILY_INDEX_LOOKBACK,
  planIndexDays,
  todayEtYYYYdMMdDD,
} from "./dailyIndexDates";
import { FetchDailyIndexTask } from "./FetchDailyIndexTask";
import { StoreCikLastUpdatedTask } from "./StoreCikLastUpdatedTask";

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

    for (const date of plan.completed) {
      await bypassCacheIfNeeded(date);
      try {
        const fetchResult = await context.own(new FetchDailyIndexTask()).run({ date });
        await context
          .own(new StoreCikLastUpdatedTask())
          .run({ updateList: fetchResult.updateList });
        lastSuccess = date;
        await cursorRepo.put({ id: DAILY_INDEX_CURSOR_ID, last_success: date });
        fetched++;
      } catch (err) {
        if (getHttpErrorStatus(err) === 404) {
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
      const fetchResult = await context.own(new FetchDailyIndexTask()).run({ date: plan.today });
      await context
        .own(new StoreCikLastUpdatedTask())
        .run({ updateList: fetchResult.updateList });
      todayFetched = true;
      fetched++;
    } catch (err) {
      if (getHttpErrorStatus(err) !== 404) {
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
