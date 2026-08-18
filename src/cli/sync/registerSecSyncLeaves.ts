/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import { CatchUpDailyIndexTask } from "../../task/index/CatchUpDailyIndexTask";
import { IdentifySpacsTask } from "../../task/spac/IdentifySpacsTask";
import { UpdateAllSubmissionsTask } from "../../task/submissions/UpdateAllSubmissionsTask";
import { runWorkflowCli } from "../runWorkflow";
import { runFormsSweep } from "./runFormsSweep";
import { listSpacProcessCiks } from "./spacSyncCiks";
import { SYNC_FORM_DOMAINS, formsForExtractorIds } from "./syncFormDomains";
import { getSyncLeaf, registerSyncLeaf, type SyncRunContext } from "./syncLeaves";

export function registerSecSyncLeaves(): void {
  if (getSyncLeaf("submissions") !== undefined) {
    return;
  }

  registerSyncLeaf({
    id: "submissions",
    description: "Catch up daily indexes and refresh submissions",
    order: 10,
    inAll: true,
    steps: [
      {
        id: "index",
        title: "Catch up daily indexes",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([
            new CatchUpDailyIndexTask({
              defaults: { from: ctx.from, lookback: ctx.lookback },
            }),
          ]);
        },
      },
      {
        id: "submissions",
        title: "Update submissions for all CIKs",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([new UpdateAllSubmissionsTask({ defaults: { force: ctx.force } })]);
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "facts",
    description: "Refresh company facts for all CIKs",
    order: 20,
    inAll: true,
    steps: [
      {
        id: "facts",
        title: "Update company facts",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([
            new UpdateAllCompanyFactsTask({
              defaults: { force: ctx.force, retryFailed: ctx.retryFailed },
            }),
          ]);
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "portals",
    description: "Process CFPORTAL registration forms",
    order: 30,
    inAll: true,
    steps: [
      {
        id: "portals",
        title: "Process portal forms",
        run: async (ctx: SyncRunContext) => {
          await runFormsSweep({
            formTypes: formsForExtractorIds([...SYNC_FORM_DOMAINS.portals]),
            shard: ctx.shard,
          });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "crowdfunding",
    description: "Process Form C family filings",
    order: 40,
    inAll: true,
    steps: [
      {
        id: "crowdfunding",
        title: "Process crowdfunding forms",
        run: async (ctx: SyncRunContext) => {
          await runFormsSweep({
            formTypes: formsForExtractorIds([...SYNC_FORM_DOMAINS.crowdfunding]),
            shard: ctx.shard,
          });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "reg-a",
    description: "Process Reg A family filings",
    order: 50,
    inAll: true,
    steps: [
      {
        id: "reg-a",
        title: "Process Reg A forms",
        run: async (ctx: SyncRunContext) => {
          await runFormsSweep({
            formTypes: formsForExtractorIds([...SYNC_FORM_DOMAINS["reg-a"]]),
            shard: ctx.shard,
          });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "forms",
    description: "Process specific form types (comma-separated)",
    order: 55,
    inAll: false,
    steps: [
      {
        id: "forms",
        title: "Process forms",
        run: async (ctx: SyncRunContext) => {
          if (!ctx.formTypes?.length) {
            throw new Error("sync forms requires a comma-separated type list");
          }
          await runFormsSweep({ formTypes: ctx.formTypes, shard: ctx.shard });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "spacs",
    description: "Identify SPAC candidates and process SPAC filings",
    order: 60,
    inAll: true,
    steps: [
      {
        id: "identify",
        title: "Identify SPAC candidates",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([new IdentifySpacsTask({ defaults: { full: ctx.full } })]);
        },
      },
      {
        id: "process",
        title: "Process SPAC filings",
        run: async (ctx: SyncRunContext) => {
          const ciks = await listSpacProcessCiks();
          if (ciks.length === 0) {
            console.log("No known SPACs or high/medium candidates");
            return;
          }
          await runFormsSweep({
            formTypes: formsForExtractorIds([...SYNC_FORM_DOMAINS.spacs]),
            shard: ctx.shard,
            ciks,
          });
        },
      },
    ],
  });
}
