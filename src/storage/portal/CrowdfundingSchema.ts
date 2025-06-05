//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, TypeNullable } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";

/**
 * Crowdfunding schema - represents crowdfunding entities
 */
export const CrowdfundingSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  file_number: Type.String({
    maxLength: 10,
    description: "File number",
  }),
  filing_date: Type.String({
    format: "date",
    description: "Filing date",
  }),
  name: Type.String({
    maxLength: 140,
    description: "Entity name",
  }),
  legal_status: Type.String({
    maxLength: 50,
    description: "Legal status",
  }),
  state_jurisdiction: Type.String({
    maxLength: 2,
    description: "State jurisdiction code",
  }),
  date_incorporation: Type.String({
    format: "date",
    description: "Date of incorporation",
  }),
  url: Type.String({
    maxLength: 255,
    description: "URL",
  }),
  portal_cik: Type.Integer({
    minimum: 0,
    description: "Portal CIK",
  }),
  status: Type.String({
    maxLength: 20,
    description: "Status",
  }),
});

export type Crowdfunding = Static<typeof CrowdfundingSchema>;

/**
 * Crowdfunding repository storage type and primary key definitions
 */
export const CrowdfundingPrimaryKeyNames = ["cik", "file_number"] as const;
export type CrowdfundingRepositoryStorage = TabularRepository<
  typeof CrowdfundingSchema,
  typeof CrowdfundingPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const CROWDFUNDING_REPOSITORY_TOKEN = createServiceToken<CrowdfundingRepositoryStorage>(
  "sec.storage.crowdfundingRepository"
);

/**
 * Crowdfunding Offerings schema - represents crowdfunding offerings
 */
export const CrowdfundingOfferingsSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  file_number: Type.String({
    maxLength: 10,
    description: "File number",
  }),
  filing_date: Type.String({
    format: "date",
    description: "Filing date",
  }),
  compensation_amount_percent: TypeNullable(
    Type.Number({
      minimum: 0,
      maximum: 1,
      description: "Compensation amount percent (decimal format)",
    })
  ),
  financial_interest_percent: TypeNullable(
    Type.Number({
      minimum: 0,
      maximum: 1,
      description: "Financial interest percent (decimal format)",
    })
  ),
  compensation_amount_detail: TypeNullable(
    Type.String({
      description: "Compensation amount detail",
    })
  ),
  financial_interest_detail: TypeNullable(
    Type.String({
      description: "Financial interest detail",
    })
  ),
  security_offered_type: TypeNullable(
    Type.String({
      description: "Security offered type",
    })
  ),
  no_of_security_offered: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Number of securities offered",
    })
  ),
  price: TypeNullable(
    Type.Number({
      minimum: 0,
      description: "Price",
    })
  ),
  price_determination_method: TypeNullable(
    Type.String({
      description: "Price determination method",
    })
  ),
  offering_amount: TypeNullable(
    Type.Number({
      minimum: 0,
      description: "Offering amount",
    })
  ),
  maximum_offering_amount: TypeNullable(
    Type.Number({
      minimum: 0,
      description: "Maximum offering amount",
    })
  ),
  over_subscription_accepted: TypeNullable(
    Type.String({
      maxLength: 3,
      description: "Over subscription accepted (YES/NO)",
    })
  ),
  deadline_date: TypeNullable(
    Type.String({
      format: "date",
      description: "Deadline date",
    })
  ),
});

export type CrowdfundingOfferings = Static<typeof CrowdfundingOfferingsSchema>;

/**
 * Crowdfunding Offerings repository storage type and primary key definitions
 */
export const CrowdfundingOfferingsPrimaryKeyNames = ["cik", "file_number", "filing_date"] as const;
export type CrowdfundingOfferingsRepositoryStorage = TabularRepository<
  typeof CrowdfundingOfferingsSchema,
  typeof CrowdfundingOfferingsPrimaryKeyNames
>;

export const CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN =
  createServiceToken<CrowdfundingOfferingsRepositoryStorage>(
    "sec.storage.crowdfundingOfferingsRepository"
  );

/**
 * Crowdfunding Reports schema - represents crowdfunding reports
 */
export const CrowdfundingReportsSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  file_number: Type.String({
    maxLength: 10,
    description: "File number",
  }),
  filing_date: Type.String({
    format: "date",
    description: "Filing date",
  }),
  disclosure_name: Type.String({
    maxLength: 50,
    description: "Disclosure name",
  }),
  disclosure_value: TypeNullable(
    Type.Number({
      minimum: 0,
      description: "Disclosure value",
    })
  ),
});

export type CrowdfundingReports = Static<typeof CrowdfundingReportsSchema>;

/**
 * Crowdfunding Reports repository storage type and primary key definitions
 */
export const CrowdfundingReportsPrimaryKeyNames = [
  "cik",
  "file_number",
  "filing_date",
  "disclosure_name",
] as const;
export type CrowdfundingReportsRepositoryStorage = TabularRepository<
  typeof CrowdfundingReportsSchema,
  typeof CrowdfundingReportsPrimaryKeyNames
>;

export const CROWDFUNDING_REPORTS_REPOSITORY_TOKEN =
  createServiceToken<CrowdfundingReportsRepositoryStorage>(
    "sec.storage.crowdfundingReportsRepository"
  );
