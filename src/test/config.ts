import { readFileSync } from "node:fs";
import path from "node:path";

import type { z } from "zod";

import {
  formatConfigIssues,
  parseEditorConfig,
  validateEditorConfig,
  type EditorConfig,
  type editorConfigSchema,
} from "@/lib/editor-config";

type CollectionInput = z.input<typeof editorConfigSchema>["collections"][number];

/** 테스트용 config. 컬렉션의 name·path만 적으면 나머지는 기본값으로 채우고 실제 검사를 거친다. */
export function testConfig(
  collections: (Omit<CollectionInput, "editor"> & Partial<Pick<CollectionInput, "editor">>)[],
  branch = "main",
): EditorConfig {
  const result = validateEditorConfig({ branch, collections: collections.map((c) => ({ editor: "wysiwyg", ...c })) });
  if (!result.ok) throw new Error(formatConfigIssues(result.issues));
  return result.config;
}

/** 실제 yjshd에 넣을 config 예시 (`docs/editor-config/yjshd.editor.config.json`). */
export function yjshdConfig(): EditorConfig {
  const file = path.resolve(import.meta.dirname, "../../docs/editor-config/yjshd.editor.config.json");
  const result = parseEditorConfig(readFileSync(file, "utf8"));
  if (!result.ok) throw new Error("config 오류");
  return result.config;
}
