//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { createServiceToken } from "@podley/util";

export const SEC_RAW_DATA_FOLDER = createServiceToken<string>("sec.raw.data.folder");
export const SEC_DB_FOLDER = createServiceToken<string>("sec.db.folder");
export const SEC_DB_NAME = createServiceToken<string>("sec.db.name");
