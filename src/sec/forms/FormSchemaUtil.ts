//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Type } from "@sinclair/typebox";

export const STRING_50_TYPE = Type.String({ minLength: 0, maxLength: 50 });
export const STRING_150_TYPE = Type.String({ minLength: 1, maxLength: 150 });
export const STRING_200_TYPE = Type.String({ minLength: 1, maxLength: 200 });
export const STRING_255_TYPE = Type.String({ maxLength: 255 });
export const POSITIVE_INTEGER_TYPE = Type.Integer({ minimum: 0, maximum: 999999999999 });

export const SCHEMA_VERSION_TYPE = Type.String({ minLength: 5, maxLength: 5 });

export const ENTITY_TYPE_LIST = Type.Union([
  Type.Literal("Corporation"),
  Type.Literal("Limited Partnership"),
  Type.Literal("Limited Liability Company"),
  Type.Literal("General Partnership"),
  Type.Literal("Business Trust"),
  Type.Literal("Other"),
]);

export const RELATIONSHIP_LIST = Type.Union([
  Type.Literal("Executive Officer"),
  Type.Literal("Director"),
  Type.Literal("Promoter"),
]);

export const TEST_LIVE_LIST = Type.Union([Type.Literal("LIVE"), Type.Literal("TEST")], {
  description: "testOrLive (LIVE or TEST)",
});

export const TRUE_FALSE_LIST = Type.Union([Type.Literal("true"), Type.Literal("false")], {
  description: "boolean as true/false strings",
});

export const IS_TRUE_TYPE = Type.Literal("true");

export const EMAIL_TYPE = Type.String({
  minLength: 1,
  pattern:
    "^([a-zA-Z0-9_\\-\\.]+)@((\\[[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.)|(([a-zA-Z0-9\\-]+\\.)+))([a-zA-Z]{2,7}|[0-9]{1,3})(\\]?)$",
});

export const ACCESSION_NUMBER_TYPE = Type.String({
  pattern: "^[*]{0}|[0-9]{1,10}\\-[0-9]{1,2}\\-[0-9]{1,6}$",
});

export const STREET_TYPE = Type.String({ minLength: 1, maxLength: 40 });
export const CITY_TYPE = Type.String({ minLength: 1, maxLength: 30 });
export const PHONE_NUMBER_TYPE = Type.String({ minLength: 1, maxLength: 20 });
export const ZIP_CODE_TYPE = Type.String({
  minLength: 1,
  maxLength: 10,
  pattern: "^[0-9A-Za-z #\\-]*$",
});

export const ENTITY_NAME_TYPE = Type.String({ minLength: 1, maxLength: 150 });

export const CIK_TYPE = Type.String({
  minLength: 1,
  maxLength: 10,
  pattern: "^[0-9]+$",
});

export const YEAR_VALUE_TYPE = Type.String({ pattern: "^2\\d\\d\\d$" });
