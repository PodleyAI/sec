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
  readonly eightKItems?: readonly string[];
}): Promise<void> {
  await runWorkflowCli(
    [],
    undefined,
    formsSweepLoop(
      newFormsWorklistTask(options.formTypes, options.shard, options.ciks, options.eightKItems)
    )
  );
}
