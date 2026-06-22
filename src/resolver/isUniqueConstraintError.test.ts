/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { isUniqueConstraintError } from "./isUniqueConstraintError";

describe("isUniqueConstraintError", () => {
  describe("SQLite / InMemory", () => {
    it("matches the canonical SQLite/InMemory message", () => {
      expect(
        isUniqueConstraintError(
          new Error(
            "UNIQUE constraint failed: canonical_person.resolver_version, canonical_person.cik"
          )
        )
      ).toBe(true);
    });

    it("matches the SQLite native error code", () => {
      expect(isUniqueConstraintError({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(true);
    });

    it("is case-insensitive on the SQLite/InMemory message", () => {
      expect(isUniqueConstraintError(new Error("unique constraint failed: foo"))).toBe(
        true
      );
      expect(isUniqueConstraintError(new Error("Unique Constraint Failed: foo"))).toBe(
        true
      );
    });
  });

  describe("Postgres", () => {
    it("matches a Postgres error by SQLSTATE code alone (no message)", () => {
      expect(isUniqueConstraintError({ code: "23505" })).toBe(true);
    });

    it("matches a Postgres error by message alone (no code)", () => {
      expect(
        isUniqueConstraintError(
          new Error(
            'duplicate key value violates unique constraint "canonical_company_uniq_resolver_version_cik"'
          )
        )
      ).toBe(true);
    });

    it("matches a Postgres error with both code and message", () => {
      const pgError = Object.assign(
        new Error(
          'duplicate key value violates unique constraint "canonical_company_uniq_resolver_version_crd_number"'
        ),
        { code: "23505" }
      );
      expect(isUniqueConstraintError(pgError)).toBe(true);
    });

    it("is case-insensitive on the Postgres message", () => {
      expect(
        isUniqueConstraintError(
          new Error("DUPLICATE KEY VALUE VIOLATES UNIQUE CONSTRAINT \"foo\"")
        )
      ).toBe(true);
    });

    it("matches the Postgres message when embedded mid-string", () => {
      expect(
        isUniqueConstraintError(
          new Error(
            'ERROR:  duplicate key value violates unique constraint "x"\nDETAIL:  Key (a)=(1) already exists.'
          )
        )
      ).toBe(true);
    });
  });

  describe("rejects unrelated errors", () => {
    it("rejects unrelated Postgres SQLSTATE codes", () => {
      expect(isUniqueConstraintError({ code: "23503" })).toBe(false); // FK violation
      expect(isUniqueConstraintError({ code: "23502" })).toBe(false); // NOT NULL violation
      expect(isUniqueConstraintError({ code: "23514" })).toBe(false); // CHECK violation
    });

    it("rejects unrelated error messages", () => {
      expect(isUniqueConstraintError(new Error("connection refused"))).toBe(false);
      expect(isUniqueConstraintError(new Error(""))).toBe(false);
      expect(isUniqueConstraintError(new Error("unique"))).toBe(false);
      expect(isUniqueConstraintError(new Error("duplicate key"))).toBe(false);
    });

    it("rejects an Error without a recognised code or message", () => {
      const e = new Error("something else broke");
      expect(isUniqueConstraintError(e)).toBe(false);
    });

    it("rejects non-Error inputs", () => {
      expect(isUniqueConstraintError(null)).toBe(false);
      expect(isUniqueConstraintError(undefined)).toBe(false);
      expect(isUniqueConstraintError("UNIQUE constraint failed")).toBe(false);
      expect(isUniqueConstraintError(23505)).toBe(false);
      expect(isUniqueConstraintError(true)).toBe(false);
      expect(isUniqueConstraintError({})).toBe(false);
      expect(isUniqueConstraintError({ message: 42 })).toBe(false);
      expect(isUniqueConstraintError({ code: 23505 })).toBe(false); // number, not string
    });
  });
});
