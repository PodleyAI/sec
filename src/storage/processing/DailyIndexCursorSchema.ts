/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

export const DailyIndexCursorSchema = Type.Object({
  id: Type.Literal("daily_index"),
  last_success: Type.String({
    description: "Last completed ET calendar day whose master.idx was applied (YYYY-MM-DD)",
  }),
});

export type DailyIndexCursor = Static<typeof DailyIndexCursorSchema>;

export const DailyIndexCursorPrimaryKeyNames = ["id"] as const;

export const DAILY_INDEX_CURSOR_ID = "daily_index" as const;

export type DailyIndexCursorRepositoryStorage = ITabularStorage<
  typeof DailyIndexCursorSchema,
  typeof DailyIndexCursorPrimaryKeyNames,
  DailyIndexCursor
>;

export const DAILY_INDEX_CURSOR_REPOSITORY_TOKEN =
  createServiceToken<DailyIndexCursorRepositoryStorage>("sec.storage.dailyIndexCursorRepository");
