//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, TypeNullable } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";

/**
 * Filing schema - represents SEC filings stored in the database
 */
export const FilingSchema = Type.Object({
  cik: TypeSecCik({
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  accession_number: Type.String({
    maxLength: 20,
    description: "SEC accession number - unique identifier for the filing",
  }),
  filing_date: Type.String({
    description: "Date the filing was submitted to the SEC (YYYY-MM-DD format)",
  }),
  report_date: TypeNullable(
    Type.String({
      description: "Report date of the filing (YYYY-MM-DD format, if applicable)",
    })
  ),
  acceptance_date: Type.String({
    description: "Date and time the filing was accepted by the SEC (ISO 8601 format)",
  }),
  form: TypeNullable(
    Type.String({
      maxLength: 8,
      description: "Form type (e.g., 10-K, 10-Q, 8-K)",
    })
  ),
  file_number: TypeNullable(
    Type.String({
      maxLength: 10,
      description: "File number assigned by the SEC",
    })
  ),
  film_number: TypeNullable(
    Type.String({
      maxLength: 10,
      description: "Film number assigned by the SEC",
    })
  ),
  primary_doc: Type.String({
    maxLength: 45,
    description: "Primary document filename",
  }),
  primary_doc_description: TypeNullable(
    Type.String({
      maxLength: 45,
      description: "Description of the primary document",
    })
  ),
  size: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Size of the filing in bytes",
    })
  ),
  is_xbrl: TypeNullable(
    Type.Boolean({
      description: "Whether the filing contains XBRL data",
    })
  ),
  is_inline_xbrl: TypeNullable(
    Type.Boolean({
      description: "Whether the filing contains inline XBRL data",
    })
  ),
  items: TypeNullable(
    Type.String({
      description: "Items covered in the filing (for certain form types)",
    })
  ),
  act: TypeNullable(
    Type.String({
      maxLength: 2,
      description: "Act under which the filing was made",
    })
  ),
});

/**
 * Filing type definition
 */
export type Filing = Static<typeof FilingSchema>;

/**
 * Primary key definition for Filing table
 */
export const FilingPrimaryKeyNames = ["cik", "accession_number"] as const;

/**
 * Filing repository storage type
 */
export type FilingRepositoryStorage = TabularRepository<
  typeof FilingSchema,
  typeof FilingPrimaryKeyNames
>;

/**
 * Dependency injection token for Filing repository
 */
export const FILING_REPOSITORY_TOKEN = createServiceToken<FilingRepositoryStorage>(
  "sec.storage.filingRepository"
);
