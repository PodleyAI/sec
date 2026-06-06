/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
  type CanonicalSponsorFamilyAliasRepositoryStorage,
} from "./CanonicalAliasSchemas";
import { CanonicalFamilyAliasRepo } from "./CanonicalFamilyAliasRepo";

interface Options {
  repository?: CanonicalSponsorFamilyAliasRepositoryStorage;
}

export class CanonicalSponsorFamilyAliasRepo extends CanonicalFamilyAliasRepo {
  constructor(options: Options = {}) {
    super(
      options.repository ??
        globalServiceRegistry.get(CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN)
    );
  }
}
