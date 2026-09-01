/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form D's related-persons list is a COMPLETE roster, so the filing may end a
 * role it no longer asserts — but only when nothing was lost on the way in.
 * The verdict is the sole record of that: a person the extractor declines
 * leaves no observation, so a later pass reading the stored observations
 * cannot tell a partial roster from a whole one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { COMPLETE_ROSTER_ROLE_SCOPES } from "../../../resolver/roleScopes";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { RoleRosterCompletenessRepo } from "../../../storage/roster/RoleRosterCompletenessRepo";
import type { RoleRosterCompleteness } from "../../../storage/roster/RoleRosterCompletenessSchema";
import { MAX_PERSON_NAME_CHARS } from "../../../util/personNameBounds";
import { Form_D } from "./Form_D";
import type { FormD } from "./Form_D.schema";
import { processFormD } from "./Form_D.storage";

/** Two related persons, both clean names, both plain individuals. */
const FIXTURE = "000101359425000042-primary_doc.xml";
const ACCESSION = "0001013594-25-000042";
const FILE_NUMBER = "021-000042";
const FILING_DATE = "2025-03-14";

async function parseFixture(): Promise<FormD> {
  const xml = readFileSync(join(__dirname, "mock_data", "form-d", FIXTURE), "utf-8");
  return await Form_D.parse("D", xml);
}

async function store(formD: FormD): Promise<void> {
  await processFormD({
    cik: parseInt(formD.primaryIssuer.cik, 10),
    file_number: FILE_NUMBER,
    accession_number: ACCESSION,
    filing_date: FILING_DATE,
    primary_doc: FIXTURE,
    formD,
  });
}

async function verdict(): Promise<RoleRosterCompleteness | undefined> {
  const rows = await new RoleRosterCompletenessRepo().listForAccessions([ACCESSION]);
  return rows.find((row) => row.role_scope === COMPLETE_ROSTER_ROLE_SCOPES.formDRelatedPerson);
}

/** People observed in the roster's own scope — signatories are a separate list. */
async function relatedPersonCount(): Promise<number> {
  const rows = await new PersonObservationRepo().listAll();
  return rows.filter(
    (row) =>
      row.accession_number === ACCESSION &&
      row.role_scope === COMPLETE_ROSTER_ROLE_SCOPES.formDRelatedPerson
  ).length;
}

describe("Form D roster completeness", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("records the roster complete when every listed person was observed", async () => {
    const formD = await parseFixture();
    expect(formD.relatedPersonsList.relatedPersonInfo).toHaveLength(2);

    await store(formD);

    expect(await relatedPersonCount()).toBe(2);
    expect(await verdict()).toEqual({
      accession_number: ACCESSION,
      extractor_id: "D",
      role_scope: COMPLETE_ROSTER_ROLE_SCOPES.formDRelatedPerson,
      company_cik: parseInt(formD.primaryIssuer.cik, 10),
      filing_date: FILING_DATE,
      complete: true,
    });
  });

  it("records the roster INCOMPLETE when a listed person is dropped, since that person leaves no observation", async () => {
    const formD = await parseFixture();
    const [first] = formD.relatedPersonsList.relatedPersonInfo;
    const dropped = {
      ...first,
      relatedPersonName: {
        ...first.relatedPersonName,
        lastName: "Q".repeat(MAX_PERSON_NAME_CHARS + 1),
      },
    };

    await store({
      ...formD,
      relatedPersonsList: {
        ...formD.relatedPersonsList,
        relatedPersonInfo: [...formD.relatedPersonsList.relatedPersonInfo, dropped],
      },
    });

    // Three listed, two stored: the third is exactly the person no observation
    // remembers, which is why the verdict has to be written down.
    expect(await relatedPersonCount()).toBe(2);
    expect((await verdict())?.complete).toBe(false);
  });

  it("records the roster INCOMPLETE when it names nobody, since an empty list is not evidence everyone left", async () => {
    const formD = await parseFixture();

    await store({
      ...formD,
      relatedPersonsList: { ...formD.relatedPersonsList, relatedPersonInfo: [] },
    });

    expect(await relatedPersonCount()).toBe(0);
    expect((await verdict())?.complete).toBe(false);
  });
});
