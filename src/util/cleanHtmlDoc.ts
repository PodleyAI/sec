//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { decode } from "html-entities";

export function cleanHtmlDoc(html: string): string {
  const doc = decode(html)
    .replaceAll("\xA0", " ")
    .replaceAll(" \n", " ")
    .replaceAll(/\n+/g, " ")
    .replaceAll(/[       ]+/g, " ");
  return doc.substring(doc.indexOf("<TEXT>") + 6);
}
