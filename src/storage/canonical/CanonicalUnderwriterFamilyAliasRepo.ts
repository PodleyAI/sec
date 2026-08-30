/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN,
  type CanonicalUnderwriterFamilyAliasRepositoryStorage,
} from "./CanonicalFamilyAliasSchemas";
import { CanonicalFamilyAliasRepo } from "./CanonicalFamilyAliasRepo";

interface Options {
  repository?: CanonicalUnderwriterFamilyAliasRepositoryStorage;
}

export class CanonicalUnderwriterFamilyAliasRepo extends CanonicalFamilyAliasRepo {
  constructor(options: Options = {}) {
    super(
      options.repository ??
        globalServiceRegistry.get(CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN)
    );
  }
}
