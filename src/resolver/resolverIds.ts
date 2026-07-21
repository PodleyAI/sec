/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { listResolverIds } from "./resolverExtensions";

/**
 * A resolver kind id. Kinds are registered at runtime via the
 * ResolverExtensionRegistry (sec's own kinds + downstream extensions), so this
 * is a runtime-validated string rather than a compile-time union.
 */
export type ResolverId = string;

/** All currently-registered resolver kind ids. */
export function resolverIds(): readonly string[] {
  return listResolverIds();
}

export { getResolverExtension, isFamilyResolverId } from "./resolverExtensions";
