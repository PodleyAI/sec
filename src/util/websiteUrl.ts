/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const PLACEHOLDERS = new Set(["n/a", "na", "none", "-", "tbd"]);

/**
 * Returns the trimmed input when it is a usable public website, otherwise
 * null. Models (and filers) invent strings like `www. .com` when no site was
 * stated; those must not be stored.
 */
export function usableWebsiteUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (value === "" || PLACEHOLDERS.has(value.toLowerCase())) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname;
    if (!host.includes(".")) return null;
    const labels = host.split(".");
    if (labels.some((label) => label.length === 0)) return null;
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
