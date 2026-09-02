#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Child process for the SIGINT spawn test. Hangs until Abort-style SIGINT,
 * then writes the marker and exits 130.
 */

import { installCliSignalTeardown } from "./installCliSignalTeardown";

const marker = process.env.CLOSE_MARKER;
if (!marker) throw new Error("CLOSE_MARKER is required");

installCliSignalTeardown({
  close: async () => {
    await Bun.write(marker, "closed");
  },
});

process.stdout.write("ready\n");
await new Promise(() => {
  /* hang until SIGINT */
});
