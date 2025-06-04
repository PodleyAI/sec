//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TypeNullable } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";
import { TypeSecCik } from "../../types/CompanySubmission";

/**
 * Person schema
 */
export const PersonSchema = Type.Object({
  person_hash_id: Type.String({ description: "Unique hash of the person" }),
  first: Type.String({ description: "First name of the person" }),
  middle: TypeNullable(Type.String({ description: "Middle name or initial of the person" })),
  last: Type.String({ description: "Last name of the person" }),
  suffix: TypeNullable(Type.String({ description: "Name suffix (Jr., Sr., III, etc.)" })),
  title: TypeNullable(Type.String({ description: "Professional title or designation" })),
  nick: TypeNullable(Type.String({ description: "Nickname of the person" })),
  dob: Type.Optional(
    TypeNullable(
      Type.String({
        minLength: 4,
        maxLength: 10,
        description: "Date of birth of the person, YYYY-MM-DD or YYYY-MM or YYYY",
      })
    )
  ),
  notes: Type.Optional(
    TypeNullable(
      Type.String({ description: "Notes used to make two people with the same name different" })
    )
  ),
});

export type Person = Static<typeof PersonSchema>;

/**
 * Person Entity Junction schema - links persons to entities (CIK entities)
 */
export const PersonsEntityJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  cik: TypeSecCik(),
  titles: Type.Array(
    Type.String({
      description: "Title of the relationship, e.g. CEO, General Counsel, etc.",
    })
  ),
  person_hash_id: Type.String({ description: "Reference to the person hash ID" }),
});

export type PersonsEntityJunction = Static<typeof PersonsEntityJunctionSchema>;

/**
 * Person Address Junction schema - links persons to addresses
 */
export const PersonsAddressJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  person_hash_id: Type.String({ description: "Reference to the person hash ID" }),
  address_hash_id: Type.String({ description: "Reference to the address hash ID" }),
});

export type PersonsAddressJunction = Static<typeof PersonsAddressJunctionSchema>;

/**
 * Person Phone Junction schema - links persons to phones
 */
export const PersonPhoneJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  person_hash_id: Type.String({ description: "Reference to the person hash ID" }),
  international_number: Type.String({ description: "Reference to the international phone number" }),
});

export type PersonPhoneJunction = Static<typeof PersonPhoneJunctionSchema>;
