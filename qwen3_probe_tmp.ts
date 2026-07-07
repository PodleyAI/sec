import { getGlobalModelRepository } from "workglow";
import { registerSecProviders } from "./src/config/registerProviders";
import { registerModelIds } from "./src/config/registerModels";
import { extractManagement } from "./src/sec/forms/registration-statements/s1/sectionExtractors";
import { EVAL_FIXTURES } from "./src/eval/fixtures";
import { scoreExtraction } from "./src/eval/scoreExtraction";

const ID = "onnx-community/Qwen3-4B-Instruct-2507-ONNX";
await registerSecProviders();
await registerModelIds([ID]);
const model = await getGlobalModelRepository().findByName(ID);
console.log("loaded record:", ID, (model as any)?.provider);
const fx = EVAL_FIXTURES[0]; // operating-company management
const t0 = Bun.nanoseconds();
const rows = await extractManagement(fx.text, model as any);
const ms = (Bun.nanoseconds() - t0) / 1e6;
const s = scoreExtraction(rows, fx.expected, { keyField: "full_name" });
console.log(`Qwen3-4B on "${fx.name}": ${ms.toFixed(0)}ms, rows=${rows.length}, score=${(s.score*100).toFixed(0)}% found=${(s.entityRecall*100).toFixed(0)}%`);
console.log("names:", rows.map((r:any) => `${r.full_name} / ${r.title}`).join(" | "));
process.exit(0);
