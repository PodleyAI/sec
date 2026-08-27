/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formsSweepLoop, newFormsWorklistTask, type FormsShard } from "../../task/forms/formsSweep";
import { runWorkflowCli } from "../runWorkflow";

export async function runFormsSweep(options: {
  readonly formTypes: string[];
  readonly shard?: FormsShard;
  readonly ciks?: number[];
  readonly filedOnOrAfter?: string;
  /**
   * What resolved to `formTypes`, named in the error below when that
   * resolution comes back empty — a sync domain id or the raw CLI tokens.
   * Optional so an external caller that already guarantees a non-empty list
   * is not forced to supply one.
   */
  readonly requestedFrom?: string;
}): Promise<void> {
  // `ComputeFormsWorklistTask` treats an empty `form` list as "every form" —
  // the right default for an explicit full sweep (no `--form` at all), which
  // never comes through here (it calls the worklist task directly). A
  // *requested* set that resolves to nothing — a `SYNC_FORM_DOMAINS` entry
  // naming an extractor id nothing registers, or CLI tokens that expand empty
  // — must not fall through to that default and quietly sweep the whole
  // corpus instead of the caller's actual request.
  if (options.formTypes.length === 0) {
    throw new Error(
      `${options.requestedFrom ?? "The requested forms"} resolved to no forms to sweep; ` +
        `refusing to fall back to sweeping every form.`
    );
  }
  await runWorkflowCli(
    [],
    undefined,
    formsSweepLoop(
      newFormsWorklistTask(options.formTypes, options.shard, options.ciks, options.filedOnOrAfter)
    )
  );
}
