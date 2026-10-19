import { readFileSync } from "node:fs";
import path from "node:path";

import { parseEditorConfig, type EditorConfig } from "@/lib/editor-config";

/** 실제 yjshd에 넣을 config 예시 (`docs/editor-config/yjshd.editor.config.json`). */
export function yjshdConfig(): EditorConfig {
  const file = path.resolve(import.meta.dirname, "../../docs/editor-config/yjshd.editor.config.json");
  const result = parseEditorConfig(readFileSync(file, "utf8"));
  if (!result.ok) throw new Error("config 오류");
  return result.config;
}
