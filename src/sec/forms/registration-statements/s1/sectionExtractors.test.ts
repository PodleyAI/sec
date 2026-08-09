/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskOutput } from "workglow";
import { Task } from "workglow";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractManagement,
  extractBeneficialOwnership,
  extractRelatedParty,
  extractSpacSponsors,
  extractOfferingTerms,
  extractUnderwriters,
  extractUseOfProceeds,
  extractMergerDeal,
  isCollectivePartyName,
  relatedPartyInstructions,
  requireNonEmptyGrammarArrays,
} from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

describe("requireNonEmptyGrammarArrays (GBNF [] shortcut guard)", () => {
  // Mirrors ManagementOutputSchema (top-level people[]; nested titles[] of strings)
  // and RelatedPartyOutputSchema (nested transactions[] of objects).
  const managementLike = {
    type: "object",
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            full_name: { type: "string" },
            titles: { type: "array", items: { type: "string" } },
          },
        },
      },
      nonce_seen: { type: "string" },
    },
  };
  const relatedPartyLike = {
    type: "object",
    properties: {
      parties: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            transactions: { type: "array", items: { type: "object", properties: {} } },
          },
        },
      },
    },
  };

  it("forces minItems:1 on top-level arrays and nested string-lists (titles)", () => {
    const out = requireNonEmptyGrammarArrays(managementLike) as any;
    expect(out.properties.people.minItems).toBe(1);
    expect(out.properties.people.items.properties.titles.minItems).toBe(1);
    // scalars untouched
    expect(out.properties.nonce_seen.minItems).toBeUndefined();
  });

  it("does NOT force nested object-lists (transactions may legitimately be empty)", () => {
    const out = requireNonEmptyGrammarArrays(relatedPartyLike) as any;
    expect(out.properties.parties.minItems).toBe(1);
    expect(out.properties.parties.items.properties.transactions.minItems).toBeUndefined();
  });

  it("does not mutate the input schema", () => {
    const input = JSON.parse(JSON.stringify(managementLike));
    requireNonEmptyGrammarArrays(input);
    expect(input).toEqual(managementLike);
  });
});

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("section extractors", () => {
  it("extractManagement returns parsed people", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: ["Director"],
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe, Director",
          },
        ],
      },
    ]);
    cleanup = unregister;
    const people = await extractManagement("Jane Roe, Director", fakeS1Model());
    expect(people).toHaveLength(1);
    expect(people[0].full_name).toBe("Jane Roe");
  });

  it("extractBeneficialOwnership returns owners with figures", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        owners: [
          {
            name: "ACME Fund",
            owner_kind: "company",
            security_class: "Common",
            shares_owned: 1000000,
            percent_owned: 12.5,
            shares_offered: null,
            shares_after: null,
            percent_after: null,
            is_selling_stockholder: false,
            footnote: null,
            confidence: 0.8,
            source_span: "ACME Fund 1,000,000 12.5%",
          },
        ],
      },
    ]);
    cleanup = unregister;
    const owners = await extractBeneficialOwnership("ACME Fund\t1,000,000\t12.5%", fakeS1Model());
    expect(owners[0].percent_owned).toBe(12.5);
  });

  it("extractRelatedParty returns parties with transactions", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        parties: [
          {
            name: "John Doe",
            party_kind: "person",
            confidence: 0.85,
            source_span: "rent to entity controlled by John Doe",
            transactions: [
              {
                counterparty: "the Company",
                nature: "lease",
                amount: 120000,
                period: "2025",
                footnote: null,
              },
            ],
          },
        ],
      },
    ]);
    cleanup = unregister;
    const parties = await extractRelatedParty("We pay rent...", fakeS1Model());
    expect(parties[0].transactions[0].amount).toBe(120000);
  });
});

it("extractOfferingTerms returns the parsed offering object", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      security_type: "Units",
      shares_offered: null,
      price: null,
      price_low: null,
      price_high: null,
      gross_proceeds: 200000000,
      net_proceeds: null,
      over_allotment_shares: null,
      units_offered: 20000000,
      price_per_unit: 10,
      unit_composition: "one share and one-half warrant",
      warrant_fraction_per_unit: 0.5,
      right_fraction_per_unit: null,
      trust_per_unit: 10.1,
      over_allotment_units: 3000000,
      exchange: "NASDAQ",
      par_value: null,
      confidence: 0.9,
      source_span: "each unit",
      tickers: [{ ticker: "ACQU", exchange: "NASDAQ", security_type: "Units", is_primary: true }],
    },
  ]);
  try {
    const got = await extractOfferingTerms("THE OFFERING ...", fakeS1Model());
    expect(got?.units_offered).toBe(20000000);
    expect(got?.tickers[0].ticker).toBe("ACQU");
  } finally {
    unregister();
  }
});

it("extractMergerDeal returns the parsed merger object", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      target_name: "Acme Target Inc.",
      pipe_amount: 150000000,
      merger_consideration: "$10.00 per share in stock",
      confidence: 0.92,
      source_span: "merger with Acme Target Inc.",
    },
  ]);
  try {
    const got = await extractMergerDeal("THE MERGER ...", fakeS1Model());
    expect(got?.target_name).toBe("Acme Target Inc.");
    expect(got?.pipe_amount).toBe(150000000);
  } finally {
    unregister();
  }
});

it("extractMergerDeal throws on schema-invalid model output (caller dead-letters it)", async () => {
  // Missing the required `confidence` field -> schema validation rejects it.
  const { unregister } = registerFakeStructuredProvider([
    { target_name: "Acme Target Inc.", pipe_amount: null, merger_consideration: null },
  ]);
  try {
    await expect(extractMergerDeal("THE MERGER ...", fakeS1Model())).rejects.toThrow();
  } finally {
    unregister();
  }
});

it("extractOfferingTerms throws on schema-invalid model output (caller dead-letters it)", async () => {
  const { unregister } = registerFakeStructuredProvider([{ tickers: [] }]);
  try {
    await expect(extractOfferingTerms("THE OFFERING ...", fakeS1Model())).rejects.toThrow();
  } finally {
    unregister();
  }
});

it("extractUnderwriters returns parsed underwriter rows", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      underwriters: [
        {
          legal_name: "Goldman Sachs & Co. LLC",
          common_name: "Goldman Sachs",
          role: "lead",
          shares_allocated: 3000000,
          over_allotment_shares: 450000,
          confidence: 0.95,
          source_span: "Goldman Sachs & Co. LLC",
        },
      ],
    },
  ]);
  try {
    const rows = await extractUnderwriters("UNDERWRITING ...", fakeS1Model());
    expect(rows[0].common_name).toBe("Goldman Sachs");
    expect(rows[0].role).toBe("lead");
  } finally {
    unregister();
  }
});

it("extractSpacSponsors returns scripted sponsor rows", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      sponsors: [
        {
          legal_name: "Pershing Square Sponsor 2, LLC",
          common_name: "Pershing Square Sponsor",
          confidence: 0.95,
          source_span: "Pershing Square Sponsor 2, LLC",
        },
      ],
    },
  ]);
  try {
    const rows = await extractSpacSponsors(
      "The Sponsor is Pershing Square Sponsor 2, LLC.",
      fakeS1Model()
    );
    expect(rows[0].common_name).toBe("Pershing Square Sponsor");
    expect(rows[0].legal_name).toBe("Pershing Square Sponsor 2, LLC");
  } finally {
    unregister();
  }
});

it("extractUseOfProceeds returns parsed line items", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      line_items: [
        {
          purpose: "repay debt",
          amount: 20000000,
          percent: 40,
          note: null,
          confidence: 0.8,
          source_span: "repay",
        },
        {
          purpose: "working capital",
          amount: null,
          percent: null,
          note: "remainder",
          confidence: 0.6,
          source_span: "wc",
        },
      ],
    },
  ]);
  try {
    const rows = await extractUseOfProceeds("USE OF PROCEEDS ...", fakeS1Model());
    expect(rows).toHaveLength(2);
    expect(rows[0].amount).toBe(20000000);
  } finally {
    unregister();
  }
});

it("forwards generation phase progress to a threaded execute context", async () => {
  // Regression guard: StructuredGenerationTask.execute() keeps only the finish
  // event and drops the phase events, so runStructured drives executeStream and
  // forwards phases itself. Without that, a threaded context sees no progress and
  // the CLI task row stays silent through every section.
  const { unregister } = registerFakeStructuredProvider([
    {
      people: [
        {
          full_name: "Jane Doe",
          titles: ["Chief Executive Officer"],
          relationship: null,
          age: null,
          bio: null,
          confidence: 0.9,
          source_span: "Jane Doe",
        },
      ],
    },
  ]);
  const messages: Array<string | undefined> = [];
  const context = {
    signal: new AbortController().signal,
    updateProgress: async (_p: number | undefined, m?: string) => {
      messages.push(m);
    },
    own: <T>(v: T): T => v,
    registry: {
      has: () => false,
      get: () => {
        throw new Error("x");
      },
    },
    resourceScope: { register: () => {}, dispose: async () => {} },
  } as any;
  try {
    const rows = await extractManagement(
      "MANAGEMENT\n\nJane Doe has served as our Chief Executive Officer.",
      fakeS1Model(),
      context
    );
    expect(rows).toHaveLength(1);
    // The generation task's phase labels reached the threaded context's row.
    expect(messages).toContain("Preparing");
    expect(messages).toContain("Generating");
  } finally {
    unregister();
  }
});

// The generation task is owned on the caller's execute context, and `own` is
// add-only — a task's subgraph is cleared only between graph runs. A node per
// section therefore pinned every section's prompt (a beneficial-ownership
// section runs to ~57k chars) for as long as the owning task lived, and under
// `extractor backfill` the owner is itself owned by the sweep.
describe("generation node reuse", () => {
  const MANAGEMENT_PAYLOAD = {
    people: [
      {
        full_name: "Jane Roe",
        titles: ["Director"],
        relationship: null,
        confidence: 0.9,
        source_span: "Jane Roe, Director",
      },
    ],
  };
  const OWNERSHIP_PAYLOAD = {
    owners: [
      {
        name: "ACME Fund",
        owner_kind: "company",
        security_class: "Common",
        shares_owned: 1000000,
        percent_owned: 12.5,
        shares_offered: null,
        shares_after: null,
        percent_after: null,
        is_selling_stockholder: false,
        footnote: null,
        confidence: 0.8,
        source_span: "ACME Fund 1,000,000 12.5%",
      },
    ],
  };

  class SectionSweepTask extends Task {
    public static override readonly type = "SectionSweepTask";
    public static override readonly category = "Test";
    public static override readonly title = "Section sweep";

    public readonly titlesSeen: string[] = [];

    override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
      await extractManagement("Jane Roe, Director", fakeS1Model(), context);
      this.titlesSeen.push(...this.subGraph.getTasks().map((t) => t.title));

      await extractBeneficialOwnership("ACME Fund\t1,000,000\t12.5%", fakeS1Model(), context);
      this.titlesSeen.push(...this.subGraph.getTasks().map((t) => t.title));
      return {};
    }
  }

  it("owns one node across a filing's sections and relabels it per section", async () => {
    const { unregister } = registerFakeStructuredProvider([MANAGEMENT_PAYLOAD, OWNERSHIP_PAYLOAD]);
    try {
      const task = new SectionSweepTask();
      await task.run();

      // Two sections, one owned generation node — not one per section.
      expect(task.subGraph.getTasks()).toHaveLength(1);
      // Relabelled per section, so a progress UI names the section running now.
      expect(task.titlesSeen).toEqual([
        "Extract management (fake-s1-model)",
        "Extract beneficial ownership (fake-s1-model)",
      ]);
    } finally {
      unregister();
    }
  });

  it("leaves no section prompt on the idle node between sections", async () => {
    const { unregister } = registerFakeStructuredProvider([MANAGEMENT_PAYLOAD, OWNERSHIP_PAYLOAD]);
    try {
      const task = new SectionSweepTask();
      await task.run();

      const node = task.subGraph.getTasks()[0];
      // Neither the construction-time `defaults` copy nor the post-run
      // `runInputData` copy may keep the section text reachable.
      expect(node.defaults.prompt).toBeUndefined();
      expect(node.runInputData.prompt).toBeUndefined();
      // Nor may the last section's extracted rows.
      expect(node.runOutputData.object).toBeUndefined();
    } finally {
      unregister();
    }
  });

  // A section that fails schema validation is the routine case (it dead-letters
  // and the filing carries on), and the node it failed on now serves every later
  // section. `run()` never clears `task.error`, so without an explicit reset the
  // failure's rejected attempt objects stay reachable for the rest of the filing
  // and the node ends up COMPLETED while still reporting an earlier section's
  // error.
  class FailThenSucceedSweepTask extends Task {
    public static override readonly type = "FailThenSucceedSweepTask";
    public static override readonly category = "Test";
    public static override readonly title = "Fail then succeed sweep";

    public firstSectionError: unknown;
    public ownerCount = 0;

    override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
      try {
        await extractManagement("Jane Roe, Director", fakeS1Model(), context);
      } catch (e) {
        this.firstSectionError = e;
      }
      const owners = await extractBeneficialOwnership(
        "ACME Fund\t1,000,000\t12.5%",
        fakeS1Model(),
        context
      );
      this.ownerCount = owners.length;
      return {};
    }
  }

  it("carries no error from a failed section onto the reused node", async () => {
    // First section's payload never satisfies ManagementOutputSchema (on the
    // retry either), so it exhausts attempts and throws.
    const { unregister } = registerFakeStructuredProvider([
      { people: "not-an-array" },
      OWNERSHIP_PAYLOAD,
    ]);
    try {
      const task = new FailThenSucceedSweepTask();
      await task.run();

      expect(task.firstSectionError).toBeDefined();
      // The later section still runs on the same node, and succeeds.
      expect(task.ownerCount).toBe(1);
      expect(task.subGraph.getTasks()).toHaveLength(1);
      const node = task.subGraph.getTasks()[0];
      expect(node.error).toBeUndefined();
    } finally {
      unregister();
    }
  });
});

describe("isCollectivePartyName", () => {
  it("catches the labels seen on a real filing", () => {
    for (const name of [
      "Our Directors",
      "Our directors",
      "Our Officers And Directors",
      "Our officers and directors",
      "Members Of Our Team",
      "Members Of Our Us", // the mangled one a live run produced
      "our management team",
      "All of our officers",
      "Certain of our affiliates",
      "The Sponsor and its members",
      // Bare role plurals: no leading determiner, so only the all-role-words
      // rule catches them. A live run let this one through and minted a person.
      "Independent Directors",
      "Executive Officers and Directors",
      "Officers",
      "Non-Employee Directors",
      "Our Initial Shareholders",
      // Role phrases the related-party prompt now asks the model to emit
      // verbatim. They must derive `group` rather than reach a resolver, and
      // the indefinite-article ones only match with `a`/`an` in the leading
      // determiner set (and `advisor` among the role words).
      "our sponsor",
      "an affiliate of our sponsor",
      "an advisor to the company",
      "The Sponsor",
    ]) {
      expect(isCollectivePartyName(name), name).toBe(true);
    }
  });

  it("does not swallow a real person or company name", () => {
    for (const name of [
      "Michael Klein",
      "Jay Taragin",
      "William Sherman",
      "Alan Officer", // a surname that is also a role word
      "Theodore Director", // leading "The" only as part of a given name
      "Citigroup Global Markets Inc.",
      "Churchill Sponsor XII LLC",
      "M. Klein and Company, LLC",
      "Directors Guild Inc.", // a company whose name starts with a role word
      "Sherman Officers", // surname + role word is still a person-ish name
      // The indefinite article is word-boundary anchored, so a name merely
      // BEGINNING with a/an is untouched even when a role word follows.
      "A. Klein & Company, LLC",
      "Alan Officer",
      "Anthony Sponsor",
    ]) {
      expect(isCollectivePartyName(name), name).toBe(false);
    }
  });

  it("is null-safe", () => {
    expect(isCollectivePartyName(null)).toBe(false);
    expect(isCollectivePartyName(undefined)).toBe(false);
    expect(isCollectivePartyName("")).toBe(false);
  });
});

describe("relatedPartyInstructions", () => {
  // The `group`/`party_label` tier exists precisely to carry a subject-less
  // Item 404 disclosure, so the prompt must not tell the model to suppress the
  // rows that feed it: a SPAC section written entirely in role phrases would
  // otherwise return nothing, losing every stated amount AND leaving a
  // permanently pending MODEL_EMPTY dead letter.
  const instructions = relatedPartyInstructions();

  it("does not ask the model to suppress role-phrase parties", () => {
    expect(instructions).not.toContain("must produce NO row");
    expect(instructions).not.toContain("EMPTY list");
  });

  it("asks for the role phrase verbatim as the party", () => {
    expect(instructions).toContain("ROLE PHRASE");
    expect(instructions).toContain("VERBATIM");
    expect(instructions).toContain("an affiliate of our sponsor");
    expect(instructions).toContain("NEVER invent or guess a proper name");
  });

  it("keeps the one-party-per-row and schema clauses", () => {
    expect(instructions).toContain("`name` must hold EXACTLY ONE party");
    expect(instructions).toContain("Return JSON matching the schema.");
  });
});
