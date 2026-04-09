/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FetchUrlJob, FetchUrlTaskInput, FetchUrlTaskOutput, JobConstructorParam } from "workglow";
import { SecUserAgent } from "../config/Constants";

export class SecFetchJob<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output = FetchUrlTaskOutput,
> extends FetchUrlJob<Input, Output> {
  constructor(config: JobConstructorParam<Input, Output>) {
    const input = { ...config.input };
    input.headers = {
      "User-Agent": SecUserAgent,
      ...input.headers,
    };
    super({ ...config, input });
  }
}
