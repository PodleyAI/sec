/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FetchUrlTaskOutput, TaskInput, TaskOutput, TaskOutputRepository } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { secDate, YYYYdMMdDD } from "../util/parseDate";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

interface SecFetchFileOutputCacheOptions {
  folderPath: string;
  outputCompression?: boolean;
  inputToFileName: (input: any) => string;
  outputSerializer?: (output: FetchUrlTaskOutput) => string | Blob;
  outputDeserializer?: (output: string | Blob) => FetchUrlTaskOutput;
  response_type?: string;
}

export class SecFetchFileOutputCache extends TaskOutputRepository {
  private folderPath: string;
  private inputToFileName: (input: any) => string;

  constructor({ folderPath, outputCompression, inputToFileName }: SecFetchFileOutputCacheOptions) {
    super({ outputCompression });
    this.folderPath = path.join(folderPath);
    this.inputToFileName = inputToFileName;
    mkdirSync(this.folderPath, { recursive: true });
  }

  outputSerializer(output: FetchUrlTaskOutput, response_type: string): any {
    if (response_type === "json") {
      return JSON.stringify(output.json);
    } else if (response_type === "text") {
      return output.text;
    } else if (response_type === "blob") {
      // writeFile cannot consume a Blob directly; convert to a Buffer.
      return output.blob;
    } else {
      console.warn(`Unknown response type: ${response_type}, assuming text`);
      return output.text;
    }
  }

  outputDeserializer(data: any, response_type: string): FetchUrlTaskOutput {
    const result: FetchUrlTaskOutput = {};
    if (response_type === "json") {
      result.json = JSON.parse(data as string);
    }
    if (response_type === "text") {
      result.text = data.toString();
    }
    if (response_type === "blob") {
      // readFile returns a Buffer; wrap it back into a Blob so downstream
      // consumers see the same shape they wrote.
      result.blob = data instanceof Blob ? data : new Blob([data]);
    }
    return result;
  }

  /**
   * Saves a task output to the repository
   * @param taskType The type of task to save the output for
   * @param input The input parameters for the task
   * @param output The task output to save
   */
  async saveOutput(taskType: string, input: TaskInput, output: TaskOutput): Promise<void> {
    if (isDryRun()) {
      return;
    }
    const responseType = input.response_type as string;
    const filePath = path.join(this.folderPath, this.inputToFileName(input));
    await mkdir(path.dirname(filePath), { recursive: true });

    // Write to a unique tmp file then atomically rename so an interrupted
    // write never produces a truncated cache entry, and so two concurrent
    // writers cannot interleave bytes targeting the same key.
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now().toString(36)}.${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    let serialized = this.outputSerializer(output, responseType);
    if (responseType === "blob" && serialized instanceof Blob) {
      serialized = Buffer.from(await serialized.arrayBuffer());
    }
    try {
      await writeFile(tmpPath, serialized, {
        encoding: responseType !== "blob" ? "utf-8" : "binary",
      });
      await rename(tmpPath, filePath);
    } catch (error) {
      // best-effort cleanup; ignore if the tmp file was never created
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    this.emit("output_saved", taskType);
  }

  /**
   * Retrieves a task output from the repository
   * @param taskType The type of task to retrieve the output for
   * @param inputs The input parameters for the task
   * @returns The retrieved task output, or undefined if not found
   */
  async getOutput(
    taskType: string,
    inputs: TaskInput & { date?: YYYYdMMdDD }
  ): Promise<TaskOutput | undefined> {
    const filePath = path.join(this.folderPath, this.inputToFileName(inputs));
    try {
      if (inputs.date) {
        const stats = await stat(filePath);
        // The cache entry is fresh only if it was written on or after the
        // input date; older mtimes mean SEC may have published newer data
        // since the entry was cached.
        const fileDate = secDate(new Date(stats.mtime));
        const inputDate = secDate(inputs.date);
        if (fileDate < inputDate) {
          return undefined;
        }
      }

      const data = await readFile(filePath);
      if (data) {
        this.emit("output_retrieved", taskType);
        return this.outputDeserializer(data, inputs.response_type as string);
      }
    } catch (error) {
      // ENOENT is the expected "cache miss" path; surface anything else so
      // permission/disk/format errors aren't silently swallowed.
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    return undefined;
  }

  async clear(): Promise<void> {
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    return 0;
  }

  async clearOlderThan(olderThanInMs: number): Promise<void> {
    return undefined;
  }

  isDurable(): boolean {
    return true;
  }
}
