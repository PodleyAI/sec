/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SecCliConfigurationError } from "./EnvToDI";

/**
 * Sampling temperature for every extraction call. Defaults to 0 (greedy).
 *
 * Extraction is a transcription task, not a generative one — the answer is
 * already in the filing — but nothing pinned the temperature, so calls ran at
 * the provider default of 1.0. Measured on one filing across three clean runs,
 * that produced 138/138/109 risk factors whose contents differed in ALL THREE
 * cases: the two 138-row runs disagreed on which captions they found, not just
 * how many. Re-processing a filing therefore rewrote its disclosures with a
 * different list each time.
 *
 * `SEC_EXTRACTION_TEMPERATURE` overrides it; an empty value omits the parameter
 * altogether.
 *
 * A malformed or out-of-range value throws rather than degrading. Coercing
 * `"0,5"` to `0` reads back as "greedy sampling is on" — the operator sees
 * exactly the behavior they asked for the opposite of, with nothing anywhere
 * saying the setting was ignored. The whole point of the variable is to control
 * determinism, so silently discarding it is the one failure mode it must not
 * have.
 *
 * It lives in `config/` rather than beside its call site because the thrown
 * error must reach the operator, not the dead-letter worklist: the CLI calls it
 * once at startup so a malformed value aborts naming the variable, instead of
 * every section of every filing recording a version-gated extraction failure
 * that no version bump can fix.
 */
export function getExtractionTemperature(): number | undefined {
  const raw = process.env.SEC_EXTRACTION_TEMPERATURE;
  if (raw === undefined) return 0;
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new SecCliConfigurationError(
      `SEC_EXTRACTION_TEMPERATURE is not a number: ${JSON.stringify(raw)}. ` +
        `Set a value in [0, 2], or set it empty to omit the parameter entirely.`
    );
  }
  if (n < 0 || n > 2) {
    throw new SecCliConfigurationError(
      `SEC_EXTRACTION_TEMPERATURE is out of range: ${n}. Sampling temperature must be in [0, 2].`
    );
  }
  return n;
}
