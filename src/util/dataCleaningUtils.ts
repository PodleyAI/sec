//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { decode } from "html-entities";

export const companyPrefixnameRegExp =
  /^(?<prefix>(\(?Managing Partner|Managing Member|Partner|General Partner\)?)\s+(of the Issuer|of Issuer|of (the )?General Partner)?)\b/i;
export const companyPostfixnameRegExp =
  /\b(?<postfix>(\(?Managing Partner|Managing Member|Partner|General Partner\)?)(\s+(of the Issuer|of Issuer|of (the )?General Partner))?)$/i;

/**
 * Returns today's date in YYYY-MM-DD format
 */
export function todayYYYYdMMdDD(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Cleans HTML document by decoding entities, normalizing whitespace, and extracting text content
 */
export function cleanHtmlDoc(html: string): string {
  const doc = decode(html)
    .replaceAll("\xA0", " ")
    .replaceAll(" \n", " ")
    .replaceAll(/\n+/g, " ")
    .replaceAll(/[       ]+/g, " ");
  return doc.substring(doc.indexOf("<TEXT>") + 6);
}
