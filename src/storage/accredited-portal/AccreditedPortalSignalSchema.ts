/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

export type AccreditedPortalSignalType = "name" | "phone" | "address";

/**
 * A known fingerprint of an accredited-investor portal: an entity name, a phone
 * number, or an address the portal is known to reuse across the SPV/fund Form D
 * filings it administers. `signal_value` is always stored in normalized form
 * (see SignalNormalization) so ingest-time matching is exact string equality.
 * The (type, value) pair is the key: one fingerprint attributes to exactly one
 * portal, and re-adding a pair re-points it.
 */
export const AccreditedPortalSignalSchema = Type.Object({
  signal_type: Type.Union([Type.Literal("name"), Type.Literal("phone"), Type.Literal("address")], {
    description: "Kind of fingerprint",
  }),
  signal_value: Type.String({
    maxLength: 512,
    description:
      "Normalized value: lower-cased normalized company name, phone international_number, or address_hash_id",
  }),
  portal_id: Type.String({ maxLength: 128, description: "Accredited portal this signal maps to" }),
  source: Type.Union([Type.Literal("seed"), Type.Literal("manual")], {
    description: "Where the signal came from; seed rows are refreshed by import, manual rows kept",
  }),
  note: TypeNullable(Type.String({ description: "Curation note" })),
  created_at: Type.String({ description: "ISO timestamp when the signal was recorded" }),
});

export type AccreditedPortalSignal = Static<typeof AccreditedPortalSignalSchema>;

export const AccreditedPortalSignalPrimaryKeyNames = ["signal_type", "signal_value"] as const;

export type AccreditedPortalSignalRepositoryStorage = ITabularStorage<
  typeof AccreditedPortalSignalSchema,
  typeof AccreditedPortalSignalPrimaryKeyNames,
  AccreditedPortalSignal
>;

export const ACCREDITED_PORTAL_SIGNAL_REPOSITORY_TOKEN =
  createServiceToken<AccreditedPortalSignalRepositoryStorage>(
    "sec.storage.accreditedPortalSignalRepository"
  );
