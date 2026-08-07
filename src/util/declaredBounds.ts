/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal structural view of a schema property — enough to find the `maxLength`
 * that becomes a `VARCHAR(n)`, including through the `anyOf`/`oneOf` wrapper
 * `TypeNullable` produces.
 */
interface BoundedProperty {
  readonly type?: string | ReadonlyArray<string>;
  readonly maxLength?: number;
  readonly anyOf?: ReadonlyArray<BoundedProperty>;
  readonly oneOf?: ReadonlyArray<BoundedProperty>;
}

interface BoundedSchema {
  readonly properties?: Record<string, BoundedProperty>;
}

/** Thrown when a value exceeds the width its own storage schema declares. */
export class DeclaredBoundsError extends Error {}

/** The `maxLength` of a property, looking through a nullable union wrapper. */
function maxLengthOf(property: BoundedProperty): number | undefined {
  if (typeof property.maxLength === "number") return property.maxLength;
  for (const branches of [property.anyOf, property.oneOf]) {
    for (const branch of branches ?? []) {
      if (branch.type === "null") continue;
      if (typeof branch.maxLength === "number") return branch.maxLength;
    }
  }
  return undefined;
}

/**
 * Verifies every row fits the string widths its storage schema declares,
 * throwing on the first violation.
 *
 * The point is WHEN this runs, not what it checks: the database enforces these
 * widths anyway, but it does so on the individual INSERT, part-way through a
 * loop that has already committed earlier rows. Where a persist spans several
 * storages — so there is no transaction to roll back — that leaves a section
 * both partly written and dead-lettered, and a truncated list is
 * indistinguishable downstream from a complete one. Checking up front converts
 * that into a clean "nothing written" failure.
 *
 * Bounds come from the schema rather than being restated here, so they cannot
 * drift from the DDL the same schema generates.
 */
export function assertWithinDeclaredBounds(
  rows: ReadonlyArray<Record<string, unknown>>,
  schema: BoundedSchema,
  label: string
): void {
  const bounds = Object.entries(schema.properties ?? {})
    .map(([column, property]) => [column, maxLengthOf(property)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined);
  if (bounds.length === 0) return;

  for (const [index, row] of rows.entries()) {
    for (const [column, maxLength] of bounds) {
      const value = row[column];
      if (typeof value === "string" && value.length > maxLength) {
        throw new DeclaredBoundsError(
          `${label} ${index}: ${column} is ${value.length} chars, over the declared ` +
            `maximum of ${maxLength} — refusing to write a partial section`
        );
      }
    }
  }
}
