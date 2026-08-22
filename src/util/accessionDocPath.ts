/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";

/**
 * Strips the EDGAR inline-XBRL viewer prefix from a primary-document filename,
 * so the raw document is what gets fetched and cached. Ownership forms 3/4/5
 * carry it (`xslF345X03/wf-form4.xml` renders `wf-form4.xml` through the
 * viewer), and every path that composes a fetch URL or a cache location must
 * agree on the bare name or the two halves of the round trip disagree.
 *
 * Deliberately separate from {@link sanitizePrimaryDoc}: a sanitizer that
 * silently rewrites its input is harder to reason about than one that only
 * accepts or rejects. Compose them — strip, then sanitize — so whatever
 * survives the strip still faces the traversal guard.
 *
 * Does not trim: the prefix is anchored at the start, so a caller that trims
 * has to decide for itself whether that happens before or after.
 */
export function stripXslPrefix(fileName: string): string {
  return fileName.replace(/^xsl[^/]+\//, "");
}

/**
 * The document filename to fetch for a filing, or `undefined` when the filing
 * names none.
 *
 * `Filing.primary_doc` is nullable and EDGAR also serves the field as an empty
 * string, so callers cannot hand it straight to {@link stripXslPrefix} — which
 * takes a `string` and would throw on a null. A filing with no primary document
 * is not a crash, it is a filing the forms pipeline dead-letters
 * `PRIMARY_DOC_UNRESOLVED`; returning `undefined` is what lets it reach that
 * path as one contained failure instead of taking its whole batch down.
 */
export function resolvePrimaryDocName(primaryDoc: string | null | undefined): string | undefined {
  const raw = (primaryDoc ?? "").trim();
  if (raw === "") return undefined;
  return stripXslPrefix(raw);
}

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
  if (resolvedPath !== resolvedDir && !resolvedPath.startsWith(resolvedDir + path.sep)) {
    throw new Error(
      `Path escapes accession-doc directory: ${JSON.stringify(fullPath)} resolved to ${JSON.stringify(resolvedPath)} (base ${JSON.stringify(resolvedDir)})`
    );
  }
}

/**
 * On-disk path for a cached accession primary document, matching
 * `ProcessAccessionDocFormTask.readCachedDoc`. An unsafe filer-authored name
 * is a miss (`undefined`), not a throw, so callers can fall through.
 */
export function cachedAccessionDocPath(
  root: string,
  cik: number,
  accessionNumber: string,
  fileName: string
): string | undefined {
  let safeName: string;
  try {
    safeName = sanitizePrimaryDoc(fileName);
  } catch {
    return undefined;
  }
  const cikDir = path.join(root, "accessiondocs", String(cik).padStart(10, "0"));
  const rel = `accessiondocs/${String(cik).padStart(10, "0")}/${accessionNumber.replaceAll(
    "-",
    ""
  )}-${safeName}`;
  const fullPath = path.join(root, rel);
  try {
    assertInsideDir(fullPath, cikDir);
  } catch {
    return undefined;
  }
  return fullPath;
}
