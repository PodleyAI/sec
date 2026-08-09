/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read an option declared with an **optional** argument (`--flag [v]`), failing
 * with the values the operator could have passed.
 *
 * Commander answers a value-less required-argument option (`--flag <v>`) with
 * `error: option '--flag <v>' argument missing` and exits — naming neither the
 * legal values nor where to find them, at the one moment the operator is asking
 * exactly that. Declaring the argument optional hands us `true` instead, which
 * this turns into an error carrying the list.
 *
 * The cost of the optional form is that `--flag` no longer consumes a following
 * token that starts with `-`; that token was previously a parse error anyway, so
 * nothing legal changes shape.
 *
 * `hint` is a thunk because several of the lists are not free to build (they
 * segment the fixture corpus or read the mock directory) and must not be paid
 * for on the ordinary path where the value was given.
 */
export function optionValue(
  flag: string,
  value: string | boolean | undefined,
  hint: () => string
): string | undefined {
  if (value === true) throw new Error(`${flag} needs a value — ${hint()}`);
  return value === undefined ? undefined : String(value);
}

/**
 * An option whose values are a closed set has a list worth printing; a count or
 * a free path does not, so those keep a required argument and Commander's own
 * message. That is why there is no numeric variant of this helper.
 *
 * A comma-separated option value, split and trimmed; `undefined` stays undefined.
 */
export function csvOptionValue(
  flag: string,
  value: string | boolean | undefined,
  hint: () => string
): string[] | undefined {
  const raw = optionValue(flag, value, hint);
  if (raw === undefined) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // `--flag ""` / `--flag ","` named nothing. Treating that as "not given" would
  // silently sweep the default set instead of what was asked for.
  if (parts.length === 0) throw new Error(`${flag} was given but names nothing — ${hint()}`);
  return parts;
}
