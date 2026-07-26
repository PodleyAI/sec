/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";

/**
 * Validates a filer-authored primary-document filename before it is used to
 * compose an on-disk cache path. Rejects anything that could escape the
 * accession-doc directory (path separators, parent-directory refs, absolute
 * paths, NUL bytes) and returns the trimmed basename.
 */
export function sanitizePrimaryDoc(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error(`Refusing unsafe primary_doc name: ${JSON.stringify(name)}`);
  }
  if (
    trimmed === ".." ||
    trimmed === "." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.startsWith("/")
  ) {
    throw new Error(`Refusing unsafe primary_doc name: ${JSON.stringify(name)}`);
  }
  return trimmed;
}

/**
 * Confirms that a composed path resolves inside a trusted directory. Throws
 * when the resolved path escapes the base directory, naming both the raw and
 * resolved values so the caller can log or attribute the offending input.
 */
export function assertInsideDir(fullPath: string, dir: string): void {
  const resolvedDir = path.resolve(dir);
  const resolvedPath = path.resolve(fullPath);
  if (
    resolvedPath !== resolvedDir &&
    !resolvedPath.startsWith(resolvedDir + path.sep)
  ) {
    throw new Error(
      `Path escapes accession-doc directory: ${JSON.stringify(fullPath)} resolved to ${JSON.stringify(resolvedPath)} (base ${JSON.stringify(resolvedDir)})`
    );
  }
}
