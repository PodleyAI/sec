/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { Type } from "typebox";
import { resolve, join, sep } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { SEC_DRY_RUN, SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { SecUserAgent } from "../../config/Constants";

export type BootstrapDownloadTaskInput = {
  readonly url: string;
  readonly targetFolder: string;
};

export type BootstrapDownloadTaskOutput = {
  readonly success: boolean;
};

/**
 * Task that downloads a bulk SEC ZIP archive and extracts it to SEC_RAW_DATA_FOLDER.
 */
export class BootstrapDownloadTask extends Task<
  BootstrapDownloadTaskInput,
  BootstrapDownloadTaskOutput
> {
  static readonly type = "BootstrapDownloadTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      url: Type.String(),
      targetFolder: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: BootstrapDownloadTaskInput,
    context: IExecuteContext
  ): Promise<BootstrapDownloadTaskOutput> {
    const dryRun =
      globalServiceRegistry.has(SEC_DRY_RUN) && globalServiceRegistry.get(SEC_DRY_RUN);

    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const targetDir = resolve(rawDataFolder, input.targetFolder);

    // Ensure targetDir is within rawDataFolder to prevent path traversal
    const safeBase = resolve(rawDataFolder) + sep;
    if (!targetDir.startsWith(safeBase)) {
      throw new Error(
        `Invalid targetFolder "${input.targetFolder}": must resolve to a subdirectory of SEC_RAW_DATA_FOLDER`
      );
    }

    if (dryRun) {
      console.log(`Would download ${input.url} to ${targetDir}`);
      return { success: true };
    }

    mkdirSync(targetDir, { recursive: true });

    const zipPath = join(rawDataFolder, `${input.targetFolder}.zip`);

    console.log(`Downloading ${input.url} ...`);
    const response = await fetch(input.url, {
      headers: { "User-Agent": SecUserAgent },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("Content-Length");
    if (contentLength) {
      const sizeMB = (parseInt(contentLength, 10) / (1024 * 1024)).toFixed(0);
      console.log(`Download size: ~${sizeMB} MB`);
    }

    await Bun.write(zipPath, response);
    console.log(`Download complete. Extracting to ${targetDir} ...`);

    const unzipPath = Bun.which("unzip");
    if (!unzipPath) {
      throw new Error(
        `The "unzip" binary was not found. Please install it (e.g., "apt install unzip" on Debian/Ubuntu or "brew install unzip" on macOS) and try again.`
      );
    }

    const proc = Bun.spawn([unzipPath, "-o", zipPath, "-d", targetDir], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`unzip exited with code ${exitCode}`);
    }

    rmSync(zipPath);
    console.log(`Extraction complete. Cleaned up ${zipPath}`);

    return { success: true };
  }
}
