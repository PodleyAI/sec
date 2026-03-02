/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { EnvToDI } from "../config/EnvToDI";
import { BootstrapAllCikNames } from "./BootstrapAllCikNames";
import { BootstrapCikLastUpdate } from "./BootstrapCikLastUpdate";
import { BootstrapSubmissions } from "./BootstrapSubmissions";
import { CompanyFacts } from "./CompanyFacts";
import { CompanySubmissions } from "./Submissions";
import { AddDailyIndexCommands } from "./DailyIndex";
import { SetupDB } from "./SetupDB";
import { UpdateAllCompanyFacts } from "./UpdateAllCompanyFacts";
import { SecJobQueueClient, SecJobQueueServer, SecJobQueueStorage } from "../fetch/SecJobQueue";
import { getTaskQueueRegistry } from "@workglow/task-graph";
import { UpdateAllSubmissions } from "./UpdateAllSubmissions";
import { Form } from "./Form";
import { Doc } from "./Doc";
import { DefaultDI } from "../config/DefaultDI";
import { UpdateAllForms } from "./UpdateAllForms";

export const AddCommands = (program: Command) => {
  EnvToDI();
  DefaultDI();

  getTaskQueueRegistry().registerQueue({
    server: SecJobQueueServer,
    client: SecJobQueueClient,
    storage: SecJobQueueStorage,
  });
  SecJobQueueServer.start();

  AddDailyIndexCommands(program);
  BootstrapAllCikNames(program);
  BootstrapCikLastUpdate(program);
  BootstrapSubmissions(program);
  CompanyFacts(program);
  CompanySubmissions(program);
  SetupDB(program);
  UpdateAllCompanyFacts(program);
  UpdateAllSubmissions(program);
  UpdateAllForms(program);
  Form(program);
  Doc(program);
};
