/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type {
  FilingConversionGate,
  GateSqlFragment,
  GateSqlPushdown,
  GateSqlRequest,
} from "../../task/document/filingConversionGate";
import { registerFilingConversionGate } from "../../task/document/filingConversionGate";
import { SPAC_REPOSITORY_TOKEN, type SpacRepositoryStorage } from "./SpacSchema";

function spacRepoIfRegistered(): SpacRepositoryStorage | undefined {
  return globalServiceRegistry.has(SPAC_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN)
    : undefined;
}

/**
 * The gate as a correlated `EXISTS` over `spac`, in one backend's quoting.
 *
 * `current_cik` as well as `cik`: a combination that moves the reporting entity
 * to a new CIK files its closing 8-K under that one, and it is the filing the
 * lifecycle most wants. The `spac` row records both.
 *
 * No parameters, so nothing here has to number itself — a fragment that bound
 * one would return it here and read {@link GateSqlRequest.firstParamIndex} for
 * its Postgres placeholder.
 */
function spacExistsFragment({ backend, filingAlias }: GateSqlRequest): GateSqlFragment {
  const q = backend === "sqlite" ? (id: string) => `\`${id}\`` : (id: string) => `"${id}"`;
  const cik = `${filingAlias}.${q("cik")}`;
  return {
    sql:
      `EXISTS (SELECT 1 FROM ${q("spac")} s ` +
      `WHERE s.${q("cik")} = ${cik} OR s.${q("current_cik")} = ${cik})`,
    params: [],
  };
}

/**
 * The known-SPAC table as the documents sweep's filer gate: an 8-K is worth
 * converting when its filer has a `spac` row.
 *
 * The `spac` table specifically, not the `spac_candidate` screen — a candidate
 * is a guess, and conversion is the expensive half of the work.
 *
 * Both members resolve the repository per call rather than closing over one.
 * The binding is what says whether this deployment has a SPAC tier at all, and
 * it changes under the sweep's feet in tests; with no binding the gate admits
 * nobody and declines the pushdown, so nothing emits SQL naming a table the
 * database may never have been given.
 */
const SPAC_FILING_CONVERSION_GATE: FilingConversionGate = {
  admittedCiks: async (): Promise<ReadonlySet<number>> => {
    const ciks = new Set<number>();
    const repo = spacRepoIfRegistered();
    if (repo === undefined) return ciks;
    for await (const spac of repo.records(1000)) {
      ciks.add(Number(spac.cik));
      if (spac.current_cik !== null && spac.current_cik !== undefined) {
        ciks.add(Number(spac.current_cik));
      }
    }
    return ciks;
  },
  pushdown: (): GateSqlPushdown | undefined => {
    const repo = spacRepoIfRegistered();
    if (repo === undefined) return undefined;
    return { storage: repo, fragment: spacExistsFragment };
  },
};

/** Register the `spac` table as the gate the documents sweep applies. */
export function registerSpacFilingConversionGate(): void {
  registerFilingConversionGate(SPAC_FILING_CONVERSION_GATE);
}
