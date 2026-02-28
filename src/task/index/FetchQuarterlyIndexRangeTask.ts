/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import { FetchQuarterlyIndexTask } from "./FetchQuarterlyIndexTask";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeDateTime } from "../../util/TypeBoxUtil";
import { Static, TObject, Type } from "typebox";

// NOTE: ONLY PREVIOUS QUARTERS' master index are immutable, current one is not (though should switch to daily)

const FetchQuarterlyIndexRangeTaskInputSchema = () =>
  Type.Object({
    startYear: Type.Number({
      title: "Start Year",
      description: "The start year of the range to fetch",
      minimum: 1993,
    }),
    startQuarter: Type.Optional(
      Type.Number({
        title: "Start Quarter",
        description: "The start quarter of the range to fetch",
        minimum: 1,
        maximum: 4,
      })
    ),
    endYear: Type.Optional(
      Type.Number({
        title: "End Year",
        description: "The end year of the range to fetch",
        minimum: 1993,
      })
    ),
    endQuarter: Type.Optional(
      Type.Number({
        title: "End Quarter",
        description: "The end quarter of the range to fetch",
        minimum: 1,
        maximum: 4,
      })
    ),
  });

export type FetchQuarterlyIndexRangeTaskInput = Static<
  ReturnType<typeof FetchQuarterlyIndexRangeTaskInputSchema>
>;

type FetchQuarterlyIndexRangeTaskOutput = {
  updateList: [cik: number, last_known_update: string][];
};

export class FetchQuarterlyIndexRangeTask extends Task<
  FetchQuarterlyIndexRangeTaskInput,
  FetchQuarterlyIndexRangeTaskOutput
> {
  static readonly type = "FetchQuarterlyIndexRangeTask";
  static readonly category = "SEC";
  static readonly cacheable = true;

  public static inputSchema() {
    return FetchQuarterlyIndexRangeTaskInputSchema();
  }

  public static outputSchema() {
    return Type.Object({
      updateList: Type.Array(Type.Tuple([TypeSecCik(), TypeDateTime()])),
    });
  }

  async execute(
    input: FetchQuarterlyIndexRangeTaskInput,
    context: IExecuteContext
  ): Promise<FetchQuarterlyIndexRangeTaskOutput> {
    if (!input.startYear) return { updateList: [] };

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;

    const startYear = input.startYear;
    const startQuarter = input.startQuarter ?? 1;
    const endYear = input.endYear ?? todayYear;
    const endQuarter = input.endQuarter ?? Math.ceil(todayMonth / 3);

    // from the date to the current date, fetch the quarterly index
    const quarters = (endYear - startYear) * 4 + (endQuarter - startQuarter);
    const dates: string[] = [];
    for (let i = 0; i < quarters; i++) {
      const fetchYear = startYear + Math.floor(i / 4);
      const fetchMonth = (i % 4) * 3 + 1;
      const fetchDay = 1;
      dates.push(
        `${fetchYear}-${fetchMonth.toString().padStart(2, "0")}-${fetchDay.toString().padStart(2, "0")}`
      );
    }

    if (dates.length === 0) return { updateList: [] };

    const wf = context.own(new Workflow());
    const loop = wf.map({ preserveOrder: false });
    loop.pipe(new FetchQuarterlyIndexTask());
    loop.endMap();
    const results = await wf.run({ date: dates });

    const updateList: Record<number, string> = {};
    for (const updateListQuarter of results.updateList as [number, string][][]) {
      for (const [cik, last_known_update] of updateListQuarter) {
        if (updateList[cik] === undefined || updateList[cik] < last_known_update) {
          updateList[cik] = last_known_update;
        }
      }
    }

    return {
      updateList: Object.entries(updateList).map(([cik, last_known_update]) => [
        parseInt(cik),
        last_known_update,
      ]),
    };
  }
}
