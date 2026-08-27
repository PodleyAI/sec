/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { startDev } from "../../storage/versioning/ceremonies";
import type { BumpType, ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { allRegisteredForms, formHandledByExtractor } from "../../sec/forms/formExtractors";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { ceremonyRepos } from "./ceremonyRepos";

/**
 * {@link snapshotTargetCount} counts the filings of every form the extractor
 * handles, and that count is written down as the promote gate's denominator.
 * An empty registry would make it 0 — a gate that passes on the first filing —
 * so the forms are established here rather than assumed from the caller.
 *
 * `registerSecFormExtractors` registers once per registry generation, so this
 * neither duplicates the bootstrap's call nor overrides a downstream
 * package's registration under a shared key.
 */
registerSecFormExtractors();

/**
 * For a major-bump extractor start-dev, snapshot the count of filings
 * handled by this extractor. Stored on the next-slot row; used as the
 * promote-gate denominator.
 *
 * This is extractor-specific today. When resolvers gain a major
 * dev-cycle, they will need their own kind-aware snapshot strategy
 * (count of observations? count of canonical identities? TBD). Add a
 * dispatch table keyed on ComponentKind when resolver support lands.
 */
async function snapshotTargetCount(kind: ComponentKind, id: string): Promise<number> {
  if (kind !== "extractor") {
    throw new Error(
      `snapshotTargetCount: kind '${kind}' is not yet supported; only 'extractor' has a snapshot strategy. Add resolver support when implemented.`
    );
  }
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const forms = allRegisteredForms().filter((form) => formHandledByExtractor(form, id));
  let total = 0;
  for (const form of forms) {
    // COUNT() path — at Form D scale (hundreds of thousands of filings)
    // materializing every row was ~100MB transient.
    total += await filingRepo.count({ form });
  }
  return total;
}

export type VersionStartDevTaskInput = {
  readonly kind: ComponentKind;
  readonly id: string;
  readonly semver: string;
  readonly bump: BumpType;
  readonly notes: string | null;
  readonly dryRun: boolean;
};

export type VersionStartDevTaskOutput = {
  readonly targetCount: number | null;
};

/**
 * Runs the start-dev ceremony: opens a dev cycle in the next slot (or applies
 * a patch bump to current in place). Major bumps snapshot the extractor's
 * filing count as the promote-gate denominator; it is returned as
 * `targetCount` (null for minor/patch bumps).
 */
export class VersionStartDevTask extends Task<VersionStartDevTaskInput, VersionStartDevTaskOutput> {
  static readonly type = "VersionStartDevTask";
  static readonly category = "SEC";
  static readonly title = "Version start-dev";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")]),
      id: Type.String(),
      semver: Type.String(),
      bump: Type.Union([Type.Literal("major"), Type.Literal("minor"), Type.Literal("patch")]),
      notes: Type.Union([Type.String(), Type.Null()]),
      dryRun: Type.Boolean(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      targetCount: Type.Union([Type.Number(), Type.Null()]),
    });
  }

  async execute(input: VersionStartDevTaskInput): Promise<VersionStartDevTaskOutput> {
    const { reg, events } = ceremonyRepos();
    const targetCount =
      input.bump === "major" ? await snapshotTargetCount(input.kind, input.id) : null;
    await startDev({
      reg,
      events,
      kind: input.kind,
      id: input.id,
      semver: input.semver,
      bump: input.bump,
      targetCount,
      notes: input.notes,
      dryRun: input.dryRun,
    });
    return { targetCount };
  }
}
