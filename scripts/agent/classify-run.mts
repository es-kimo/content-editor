/** 사용법: node scripts/agent/classify-run.mts <execution_file> → RunInfo JSON 출력 */
import { existsSync, readFileSync } from "node:fs";

import { classifyRun } from "./classify.mts";

const file = process.argv[2];
let messages: unknown = null;
if (file && existsSync(file)) {
  try {
    messages = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    messages = null;
  }
}
console.log(JSON.stringify(classifyRun(messages)));
