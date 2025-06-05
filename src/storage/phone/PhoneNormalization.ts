//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { parsePhoneNumber } from "awesome-phonenumber";
import type { Phone } from "./PhoneSchema";

export interface PhoneImport {
  phone_raw: string;
  country_code?: string;
}

/**
 * Cleans and normalizes a phone import object
 */
export function normalizePhone(importPhone: PhoneImport | null): Phone | undefined {
  if (!importPhone) return undefined;
  const phone_raw = importPhone.phone_raw.trim();
  if (!phone_raw) return undefined;
  if (phone_raw == "(000) 000-0000") return undefined;

  try {
    const countryCode = importPhone.country_code || "US";
    const phoneNumber = parsePhoneNumber(importPhone.phone_raw, {
      regionCode: countryCode,
    });

    if (!phoneNumber.possible) {
      return undefined;
    }

    const international_number = phoneNumber.number?.international;
    if (!international_number) {
      return undefined;
    }

    const phone: Phone = {
      country_code: countryCode,
      international_number,
      type: phoneNumber.type || "unknown",
      raw_phone: importPhone.phone_raw,
    };

    return phone;
  } catch (error) {
    return undefined;
  }
}
