/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BumpType } from "./ComponentVersionSchema";

export interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parses MAJOR.MINOR.PATCH. Returns undefined on malformed input. Pre-release
 * and build metadata suffixes are intentionally unsupported in v1.
 */
export function parseSemver(s: string): SemverParts | undefined {
  const m = SEMVER_RE.exec(s);
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 * Returns just the major/minor pair. Throws on malformed input.
 */
export function semverMajorMinor(s: string): { major: number; minor: number } {
  const p = parseSemver(s);
  if (!p) throw new Error(`invalid semver: ${s}`);
  return { major: p.major, minor: p.minor };
}

/**
 * Returns the "M.N." prefix string for SQL LIKE / startsWith matching.
 */
export function semverMajorMinorPrefix(s: string): string {
  const { major, minor } = semverMajorMinor(s);
  return `${major}.${minor}.`;
}

/**
 * Returns undefined when the transition is valid; otherwise an error message
 * describing what's wrong. Caller decides whether to throw or return.
 *
 * Rules:
 *   major: major++ , minor=0, patch=0
 *   minor: major same, minor++, patch=0
 *   patch: major same, minor same, patch++
 */
export function validateBumpProgression(
  fromSemver: string,
  toSemver: string,
  bump: BumpType
): string | undefined {
  const from = parseSemver(fromSemver);
  const to = parseSemver(toSemver);
  if (!from) return `invalid semver: ${fromSemver}`;
  if (!to) return `invalid semver: ${toSemver}`;

  if (bump === "major") {
    if (to.major !== from.major + 1) return `major must increment by 1 (${fromSemver} → ${toSemver})`;
    if (to.minor !== 0) return `major bump must reset minor to 0 (got ${toSemver})`;
    if (to.patch !== 0) return `major bump must reset patch to 0 (got ${toSemver})`;
    return undefined;
  }

  if (bump === "minor") {
    if (to.major !== from.major) return `minor bump: major must stay the same (${fromSemver} → ${toSemver})`;
    if (to.minor !== from.minor + 1) return `minor must increment by 1 (${fromSemver} → ${toSemver})`;
    if (to.patch !== 0) return `minor bump must reset patch to 0 (got ${toSemver})`;
    return undefined;
  }

  // patch
  if (to.major !== from.major) return `patch bump: major must stay the same (${fromSemver} → ${toSemver})`;
  if (to.minor !== from.minor) return `patch bump: minor must stay the same (${fromSemver} → ${toSemver})`;
  if (to.patch !== from.patch + 1) return `patch must increment by 1 (${fromSemver} → ${toSemver})`;
  return undefined;
}
