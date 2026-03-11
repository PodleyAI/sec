import { globalServiceRegistry } from "@workglow/util";
import { SEC_DRY_RUN } from "../config/tokens";

export function isDryRun(): boolean {
  return globalServiceRegistry.has(SEC_DRY_RUN) && globalServiceRegistry.get(SEC_DRY_RUN);
}
