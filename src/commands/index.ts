/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { EnvToDI } from "../config/EnvToDI";
import { SecJobQueueClient, SecJobQueueServer, SecJobQueueStorage } from "../fetch/SecJobQueue";
import { getTaskQueueRegistry } from "@workglow/task-graph";
import { DefaultDI } from "../config/DefaultDI";
import { addBootstrapCommands } from "../cli/groups/bootstrap";
import { addSyncCommand } from "../cli/groups/sync";
import { addUpdateCommands } from "../cli/groups/update";
import { addFetchCommands } from "../cli/groups/fetch";
import { addQueryCommands } from "../cli/groups/query";
import { addDbCommands } from "../cli/groups/db";
import { addInitCommand } from "../cli/groups/init";

export const AddCommands = (program: Command): void => {
  EnvToDI();
  DefaultDI();

  getTaskQueueRegistry().registerQueue({
    server: SecJobQueueServer,
    client: SecJobQueueClient,
    storage: SecJobQueueStorage,
  });
  SecJobQueueServer.start();

  addBootstrapCommands(program);
  addSyncCommand(program);
  addUpdateCommands(program);
  addFetchCommands(program);
  addQueryCommands(program);
  addDbCommands(program);
  addInitCommand(program);
};
