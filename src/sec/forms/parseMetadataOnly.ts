/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Empty parse for extractors that never read the document body. Form 25-NSE
 * documents live under the exchange CIK, so an issuer-CIK fetch 404s; the
 * extractor records from filings-table metadata instead.
 */
export async function parseMetadataOnlyForm(
  _form: string,
  _xml: string
): Promise<Record<string, never>> {
  return {};
}
