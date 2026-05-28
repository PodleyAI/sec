/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";

/**
 * One row per Form 144 / 144/A filing. The single `securitiesInformation`
 * block (proposed sale + broker) is folded in here, since it is 1:1 with the
 * notice. Dates are stored verbatim as the US-format (MM/DD/YYYY) strings
 * EDGAR emits.
 */
export const Form144FilingSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  form: Type.String({ maxLength: 10 }),
  submission_type: TypeNullable(Type.String({ maxLength: 10 })),
  issuer_cik: TypeSecCik(),
  issuer_name: Type.String({ maxLength: 150 }),
  sec_file_number: TypeNullable(Type.String({ maxLength: 30 })),
  person_for_whose_account: TypeNullable(Type.String({ maxLength: 150 })),
  relationships_to_issuer: TypeNullable(Type.String({ maxLength: 255 })),
  securities_class_title: TypeNullable(Type.String({ maxLength: 255 })),
  broker_name: TypeNullable(Type.String({ maxLength: 255 })),
  no_of_units_sold: TypeNullable(Type.Number()),
  aggregate_market_value: TypeNullable(Type.Number()),
  no_of_units_outstanding: TypeNullable(Type.Number()),
  approx_sale_date: TypeNullable(Type.String({ maxLength: 12 })),
  securities_exchange_name: TypeNullable(Type.String({ maxLength: 100 })),
  nothing_to_report_past_3_months: Type.Boolean(),
  notice_date: TypeNullable(Type.String({ maxLength: 12 })),
  filing_date: TypeNullable(Type.String()),
});

export type Form144Filing = Static<typeof Form144FilingSchema>;

export const Form144FilingPrimaryKeyNames = ["accession_number"] as const;
export type Form144FilingRepositoryStorage = ITabularStorage<
  typeof Form144FilingSchema,
  typeof Form144FilingPrimaryKeyNames,
  Form144Filing
>;

export const FORM144_FILING_REPOSITORY_TOKEN = createServiceToken<Form144FilingRepositoryStorage>(
  "sec.storage.form144FilingRepository"
);

/**
 * One row per `securitiesToBeSold` entry: a lot of securities being sold and
 * how/when it was acquired.
 */
export const Form144AcquisitionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  acquisition_index: Type.Integer({ minimum: 0 }),
  issuer_cik: TypeSecCik(),
  securities_class_title: TypeNullable(Type.String({ maxLength: 255 })),
  acquired_date: TypeNullable(Type.String({ maxLength: 12 })),
  nature_of_acquisition: TypeNullable(Type.String({ maxLength: 255 })),
  name_of_person_from_whom_acquired: TypeNullable(Type.String({ maxLength: 150 })),
  is_gift: TypeNullable(Type.Boolean()),
  amount_acquired: TypeNullable(Type.Number()),
  payment_date: TypeNullable(Type.String({ maxLength: 12 })),
  nature_of_payment: TypeNullable(Type.String({ maxLength: 255 })),
});

export type Form144Acquisition = Static<typeof Form144AcquisitionSchema>;

export const Form144AcquisitionPrimaryKeyNames = ["accession_number", "acquisition_index"] as const;
export type Form144AcquisitionRepositoryStorage = ITabularStorage<
  typeof Form144AcquisitionSchema,
  typeof Form144AcquisitionPrimaryKeyNames,
  Form144Acquisition
>;

export const FORM144_ACQUISITION_REPOSITORY_TOKEN =
  createServiceToken<Form144AcquisitionRepositoryStorage>(
    "sec.storage.form144AcquisitionRepository"
  );

/**
 * One row per `securitiesSoldInPast3Months` entry: a sale already made in the
 * trailing three months that the notice must disclose.
 */
export const Form144RecentSaleSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  sale_index: Type.Integer({ minimum: 0 }),
  issuer_cik: TypeSecCik(),
  seller_name: TypeNullable(Type.String({ maxLength: 150 })),
  securities_class_title: TypeNullable(Type.String({ maxLength: 255 })),
  sale_date: TypeNullable(Type.String({ maxLength: 12 })),
  amount_sold: TypeNullable(Type.Number()),
  gross_proceeds: TypeNullable(Type.Number()),
});

export type Form144RecentSale = Static<typeof Form144RecentSaleSchema>;

export const Form144RecentSalePrimaryKeyNames = ["accession_number", "sale_index"] as const;
export type Form144RecentSaleRepositoryStorage = ITabularStorage<
  typeof Form144RecentSaleSchema,
  typeof Form144RecentSalePrimaryKeyNames,
  Form144RecentSale
>;

export const FORM144_RECENT_SALE_REPOSITORY_TOKEN =
  createServiceToken<Form144RecentSaleRepositoryStorage>(
    "sec.storage.form144RecentSaleRepository"
  );
