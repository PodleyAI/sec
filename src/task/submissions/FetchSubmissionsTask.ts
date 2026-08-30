/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  Dataflow,
  FetchUrlTaskOutput,
  IExecuteContext,
  Task,
  TaskFailedError,
  TaskGraph,
  Workflow,
} from "workglow";
import {
  CompanySubmissionSchema,
  Filings,
  FullCompanySubmissionSchema,
  TypeFilings,
  TypeSecCik,
} from "../../sec/submissions/EnititySubmissionSchema";
import { secDate, TypeOptionalSecDate } from "../../util/parseDate";
import { SecFetchSubmissionsTask } from "./SecFetchSubmissionsTask";

// NOTE: company submissions are mutable, so we need to pass in a date to break the cache

const FetchSubmissionsTaskInputSchema = () =>
  Type.Object({
    cik: TypeSecCik(),
    date: TypeOptionalSecDate(),
  });

export type FetchSubmissionsTaskInput = Static<ReturnType<typeof FetchSubmissionsTaskInputSchema>>;

const FetchSubmissionsTaskOutputSchema = () =>
  Type.Object({
    submission: CompanySubmissionSchema(),
    filings: TypeFilings(),
  });

export type FetchSubmissionsOutput = Static<ReturnType<typeof FetchSubmissionsTaskOutputSchema>>;

export class FetchSubmissionsTask extends Task<FetchSubmissionsTaskInput, FetchSubmissionsOutput> {
  static readonly type = "FetchSubmissionsTask";
  static readonly category = "SEC";
  static readonly title = "Fetch company submissions";
  static readonly cacheable = true;

  public static inputSchema() {
    return FetchSubmissionsTaskInputSchema();
  }

  public static outputSchema() {
    return FetchSubmissionsTaskOutputSchema();
  }

  async execute(
    input: FetchSubmissionsTaskInput,
    context: IExecuteContext
  ): Promise<FetchSubmissionsOutput> {
    const cik = input.cik;
    if (!cik) throw new TaskFailedError("CIK is required");
    const date = input.date ? secDate(input.date) : undefined;

    const builder = context.own(new Workflow(), { title: `Fetch submissions for CIK ${cik}` });
    builder.pipe(
      new SecFetchSubmissionsTask(input, {
        id: "fetch-company-submissions",
        title: `Download CIK ${cik} submissions`,
      }),
      async function cleanupInput(input) {
        try {
          const edgarJson = Value.Encode(FullCompanySubmissionSchema(), input.json);
          const { filings, ...submission } = edgarJson;
          const { recent, files } = filings;
          return { submission, filings: recent, files };
        } catch (e) {
          console.error(e);
          throw e;
        }
      },
      async function combineFilings(input, config) {
        const graph = config.own(new TaskGraph(), { title: `Fetch paged filings for CIK ${cik}` });
        graph.addTask(async function passThroughOriginalFilings() {
          return { filings: input.filings };
        });
        for (const file of input.files || []) {
          const fileName = file.name;
          graph.addTask(
            new SecFetchSubmissionsTask(
              {
                cik: cik,
                date: date,
                file: fileName,
              },
              { id: `fetch-${fileName}`, title: `Download ${fileName}` }
            )
          );
          graph.addTask(
            async function reduceFilings(input: FetchUrlTaskOutput, context: IExecuteContext) {
              // example submissions/CIK0000001750-submissions-001.json
              const filings = Value.Encode(TypeFilings(), input.json);
              return {
                filings: filings,
              };
            },
            { id: `parse-${fileName}`, title: `Parse ${fileName}` }
          );
          graph.addDataflow(new Dataflow(`fetch-${fileName}`, "json", `parse-${fileName}`, "json"));
        }

        const graphResult = await graph.run();
        // The columnar pages are concatenated per key, so every column has to
        // advance by the same number of rows per page or the columns shear
        // against each other. A page may legitimately omit an optional column
        // (`isXBRLNumeric` postdates `isXBRL`, so archived payloads lack it);
        // pad those with nulls for that page's row count rather than skipping
        // them, which would shift every later page's values up a column.
        let allFilings: { [key: string]: any[] } = {};
        let rowsSoFar = 0;
        for (const result of graphResult) {
          const { filings } = result.data as { filings: Filings };
          const pageRows = filings.accessionNumber?.length ?? 0;
          for (const key of Object.keys(filings)) {
            if (!allFilings[key]) {
              allFilings[key] = new Array(rowsSoFar).fill(null);
            }
          }
          for (const key of Object.keys(allFilings)) {
            const column = filings[key as keyof Filings];
            if (column === undefined) {
              allFilings[key].push(...new Array(pageRows).fill(null));
            } else {
              allFilings[key].push(...column);
            }
          }
          rowsSoFar += pageRows;
        }

        return { submission: input.submission, filings: allFilings };
      }
    );
    const output = await builder.run();
    return output as FetchSubmissionsOutput;
  }
}
