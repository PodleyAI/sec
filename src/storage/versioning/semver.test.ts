/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  parseSemver,
  semverMajorMinor,
  semverMajorMinorPrefix,
  validateBumpProgression,
} from "./semver";

describe("parseSemver", () => {
  it("parses valid semver", () => {
    expect(parseSemver("0.0.1")).toEqual({ major: 0, minor: 0, patch: 1 });
    expect(parseSemver("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(parseSemver("12.34.56")).toEqual({ major: 12, minor: 34, patch: 56 });
  });
  it("returns undefined for malformed input", () => {
    expect(parseSemver("")).toBeUndefined();
    expect(parseSemver("1.0")).toBeUndefined();
    expect(parseSemver("v1.0.0")).toBeUndefined();
    expect(parseSemver("1.0.0-alpha")).toBeUndefined();
    expect(parseSemver("foo")).toBeUndefined();
  });
});

describe("semverMajorMinor", () => {
  it("returns the major.minor pair", () => {
    expect(semverMajorMinor("1.0.0")).toEqual({ major: 1, minor: 0 });
    expect(semverMajorMinor("2.5.99")).toEqual({ major: 2, minor: 5 });
  });
  it("throws on malformed input", () => {
    expect(() => semverMajorMinor("bad")).toThrow(/invalid semver/i);
  });
});

describe("semverMajorMinorPrefix", () => {
  it("returns 'M.N.' prefix string", () => {
    expect(semverMajorMinorPrefix("1.0.0")).toBe("1.0.");
    expect(semverMajorMinorPrefix("2.5.99")).toBe("2.5.");
  });
});

describe("validateBumpProgression", () => {
  it("accepts major bump", () => {
    expect(validateBumpProgression("1.5.7", "2.0.0", "major")).toBeUndefined();
    expect(validateBumpProgression("0.1.0", "1.0.0", "major")).toBeUndefined();
  });
  it("rejects major bump that doesn't reset minor/patch to 0", () => {
    expect(validateBumpProgression("1.0.0", "2.1.0", "major")).toMatch(/reset minor/i);
    expect(validateBumpProgression("1.0.0", "2.0.1", "major")).toMatch(/reset patch/i);
  });
  it("rejects major bump that doesn't increment major", () => {
    expect(validateBumpProgression("1.0.0", "1.0.1", "major")).toMatch(/major must increment/i);
  });

  it("accepts minor bump", () => {
    expect(validateBumpProgression("1.0.5", "1.1.0", "minor")).toBeUndefined();
  });
  it("rejects minor bump that doesn't reset patch", () => {
    expect(validateBumpProgression("1.0.0", "1.1.5", "minor")).toMatch(/reset patch/i);
  });
  it("rejects minor bump that doesn't increment minor", () => {
    expect(validateBumpProgression("1.0.0", "1.0.5", "minor")).toMatch(/minor must increment/i);
    expect(validateBumpProgression("1.0.0", "2.0.0", "minor")).toMatch(/major must stay the same/i);
  });

  it("accepts patch bump", () => {
    expect(validateBumpProgression("1.0.0", "1.0.1", "patch")).toBeUndefined();
    expect(validateBumpProgression("1.0.99", "1.0.100", "patch")).toBeUndefined();
  });
  it("rejects patch bump that doesn't increment patch", () => {
    expect(validateBumpProgression("1.0.0", "1.0.0", "patch")).toMatch(/patch must increment/i);
    expect(validateBumpProgression("1.0.0", "1.1.0", "patch")).toMatch(/minor must stay the same/i);
  });

  it("rejects malformed input", () => {
    expect(validateBumpProgression("bad", "1.0.0", "major")).toMatch(/invalid semver/i);
    expect(validateBumpProgression("1.0.0", "bad", "major")).toMatch(/invalid semver/i);
  });
});
