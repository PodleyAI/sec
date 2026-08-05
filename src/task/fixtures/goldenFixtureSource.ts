/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * EDGAR-backed {@link GoldenFixtureDeps} for {@link runGoldenFixtures}.
 *
 * Deliberately a plain `fetch` rather than the cached/queued `SecCachedFetchTask`
 * path: this command audits the bytes EDGAR serves *right now*, so a cache layer
 * between it and sec.gov would defeat the point.
 */

import type { GoldenFixtureDeps } from "./goldenFixtures";

const SEC_UA = process.env.SEC_USER_AGENT ?? "workglow-sec research contact@workglow.dev";

/** EDGAR asks for <= 10 req/s; the corpus is tiny, so pace it well under that. */
const REQUEST_SPACING_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function edgarGoldenFixtureDeps(
  log: (msg: string) => void = (m) => process.stderr.write(m + "\n")
): GoldenFixtureDeps {
  let previous = Promise.resolve();
  return {
    log,
    fetchDoc: async (url: string) => {
      // Serialize + space the requests: the manifest walk is sequential today,
      // but rate limiting belongs with the transport rather than the caller.
      previous = previous.then(() => sleep(REQUEST_SPACING_MS));
      await previous;
      const res = await fetch(url, { headers: { "User-Agent": SEC_UA } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
