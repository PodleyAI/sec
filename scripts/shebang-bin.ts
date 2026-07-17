#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `bun build --no-bundle` strips the source shebang and leaves a non-executable
 * file. Restore both so `package.json` `bin` works when invoked directly.
 */
const path = process.argv[2];
if (!path) {
  console.error("usage: shebang-bin.ts <file>");
  process.exit(1);
}

const body = await Bun.file(path).text();
if (!body.startsWith("#!")) {
  await Bun.write(path, `#!/usr/bin/env bun\n${body}`);
}
await Bun.$`chmod +x ${path}`;
