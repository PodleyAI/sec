//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import Value from "typebox/value";
import { ChangeLogSchema, type ChangeLog } from "./ChangeLogSchema";

describe("ChangeLogSchema", () => {
  const validChangeLog: ChangeLog = {
    change_id: "550e8400-e29b-41d4-a716-446655440000",
    entity_type: "entity",
    entity_id: "1234567",
    field_name: "name",
    old_value: "Old Company Name",
    new_value: "New Company Name",
    change_type: "update",
    change_source: "10-K",
    change_date: "2024-01-01T00:00:00Z",
    filing_accession_number: "0001234567-24-000001",
    batch_id: "batch-123",
    user_id: "system",
    metadata: JSON.stringify({ reason: "Annual report update" }),
  };

  it("should validate a valid change log entry", () => {
    const isValid = Value.Check(ChangeLogSchema, validChangeLog);
    expect(isValid).toBe(true);
  });

  it("should validate all entity types", () => {
    const entityTypes = [
      "entity",
      "address",
      "company",
      "person",
      "phone",
      "entity_address_junction",
      "entity_company_junction",
      "entity_person_junction",
      "entity_phone_junction",
    ];

    entityTypes.forEach((entityType) => {
      const changeLog: ChangeLog = {
        ...validChangeLog,
        entity_type: entityType as any,
      };

      const isValid = Value.Check(ChangeLogSchema, changeLog);
      expect(isValid).toBe(true);
    });
  });

  it("should validate all change types", () => {
    const changeTypes = ["create", "update", "delete"];

    changeTypes.forEach((changeType) => {
      const changeLog: ChangeLog = {
        ...validChangeLog,
        change_type: changeType as any,
      };

      const isValid = Value.Check(ChangeLogSchema, changeLog);
      expect(isValid).toBe(true);
    });
  });

  it("should validate change log with null optional fields", () => {
    const minimalChangeLog: ChangeLog = {
      change_id: "550e8400-e29b-41d4-a716-446655440001",
      entity_type: "entity",
      entity_id: "1234567",
      field_name: "sic",
      old_value: null,
      new_value: "3841",
      change_type: "create",
      change_source: "INITIAL_LOAD",
      change_date: "2024-01-01T00:00:00Z",
      filing_accession_number: null,
      batch_id: null,
      user_id: null,
      metadata: null,
    };

    const isValid = Value.Check(ChangeLogSchema, minimalChangeLog);
    expect(isValid).toBe(true);
  });

  it("should reject invalid entity type", () => {
    const invalidChangeLog = {
      ...validChangeLog,
      entity_type: "invalid_type",
    };

    const isValid = Value.Check(ChangeLogSchema, invalidChangeLog);
    expect(isValid).toBe(false);
  });

  it("should reject invalid change type", () => {
    const invalidChangeLog = {
      ...validChangeLog,
      change_type: "modify", // not a valid change type
    };

    const isValid = Value.Check(ChangeLogSchema, invalidChangeLog);
    expect(isValid).toBe(false);
  });

  it("should validate complex metadata", () => {
    const complexMetadata = {
      reason: "Merger and acquisition",
      previous_names: ["Company A", "Company B"],
      effective_date: "2024-01-01",
      approved_by: "SEC",
      filing_urls: ["https://sec.gov/filing1", "https://sec.gov/filing2"],
    };

    const changeLog: ChangeLog = {
      ...validChangeLog,
      metadata: JSON.stringify(complexMetadata),
    };

    const isValid = Value.Check(ChangeLogSchema, changeLog);
    expect(isValid).toBe(true);
  });

  it("should handle creation change with null old_value", () => {
    const createLog: ChangeLog = {
      ...validChangeLog,
      change_type: "create",
      old_value: null,
      new_value: JSON.stringify({
        cik: 1234567,
        name: "New Company Inc.",
        sic: 3841,
      }),
    };

    const isValid = Value.Check(ChangeLogSchema, createLog);
    expect(isValid).toBe(true);
  });

  it("should handle deletion change with null new_value", () => {
    const deleteLog: ChangeLog = {
      ...validChangeLog,
      change_type: "delete",
      old_value: JSON.stringify({
        cik: 1234567,
        name: "Deleted Company Inc.",
      }),
      new_value: null,
    };

    const isValid = Value.Check(ChangeLogSchema, deleteLog);
    expect(isValid).toBe(true);
  });

  it("should reject missing required fields", () => {
    const requiredFields = [
      "change_id",
      "entity_type",
      "entity_id",
      "field_name",
      "change_type",
      "change_source",
      "change_date",
    ];

    requiredFields.forEach((field) => {
      const invalidLog = { ...validChangeLog };
      delete (invalidLog as any)[field];

      const isValid = Value.Check(ChangeLogSchema, invalidLog);
      expect(isValid).toBe(false);
    });
  });

  it("should validate different change sources", () => {
    const changeSources = [
      "10-K",
      "10-Q",
      "8-K",
      "DEF 14A",
      "SUBMISSION_UPDATE",
      "DAILY_INDEX",
      "QUARTERLY_INDEX",
      "MANUAL_UPDATE",
      "API_UPDATE",
      "BULK_IMPORT",
    ];

    changeSources.forEach((source) => {
      const changeLog: ChangeLog = {
        ...validChangeLog,
        change_source: source,
      };

      const isValid = Value.Check(ChangeLogSchema, changeLog);
      expect(isValid).toBe(true);
    });
  });

  it("should validate batch operations", () => {
    const batchId = "batch-20240101-123456";
    const batchChanges: ChangeLog[] = [
      {
        ...validChangeLog,
        change_id: "id-1",
        field_name: "name",
        batch_id: batchId,
      },
      {
        ...validChangeLog,
        change_id: "id-2",
        field_name: "sic",
        batch_id: batchId,
      },
      {
        ...validChangeLog,
        change_id: "id-3",
        field_name: "state_incorporation",
        batch_id: batchId,
      },
    ];

    batchChanges.forEach((change) => {
      const isValid = Value.Check(ChangeLogSchema, change);
      expect(isValid).toBe(true);
    });
  });
});
