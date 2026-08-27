/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `role_scope` values whose filings name everyone holding the role, so a
 * later one omitting a person is evidence they left. Every other scope is
 * assert-only: absence proves nothing and never ends a tenure.
 *
 * Lives beside the closure contract rather than beside any one reader: the
 * storage modules that run a roster closure pass take their scope from here,
 * and so does anything recomputing tenures from stored evidence, so the set
 * and the call sites cannot drift apart.
 */
export const COMPLETE_ROSTER_ROLE_SCOPES = {
  formDRelatedPerson: "form-d:related-person",
  s1Management: "s1:management",
} as const;

const COMPLETE_ROSTER_ROLE_SCOPE_VALUES: ReadonlySet<string> = new Set(
  Object.values(COMPLETE_ROSTER_ROLE_SCOPES)
);

/** Whether a filing in this scope may end a tenure it does not assert. */
export function isCompleteRosterRoleScope(role_scope: string): boolean {
  return COMPLETE_ROSTER_ROLE_SCOPE_VALUES.has(role_scope);
}
