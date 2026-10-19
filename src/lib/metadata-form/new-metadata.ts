import type { Collection, MetadataField } from "@/lib/editor-config";
import type { MetadataValue } from "@/lib/mdx-doc";

import { set, type MetadataObject } from "./form";

/**
 * 새 글의 metadata. `title`을 맨 앞에 두고 config에 적힌 필드를 순서대로 기본값으로 채운다.
 * 기존 글처럼 빈 description·keywords도 키를 둔다. 사이트가 키가 있다고 보고 읽을 수 있어서다.
 */
export function newMetadata(collection: Collection, title: string, now: Date): MetadataObject {
  const metadata: MetadataObject = { title };
  for (const [key, field] of Object.entries(collection.metadata)) {
    if (key === "title") continue;
    set(metadata, key, defaultValue(field, now));
  }
  return metadata;
}

function defaultValue(field: MetadataField, now: Date): MetadataValue {
  switch (field.type) {
    case "string":
    case "text":
      return "";
    case "string[]":
      return [];
    // 첫 선택지를 기본으로 한다. yjshd 게시판은 ["ready", "draft"]라 만든 글이 바로 사이트 목록에 나온다.
    case "select":
      return field.options[0]!;
    // 폼이 원래 값이 없을 때 쓰는 형식(`YYYY-MM-DDTHH:mm:ssZ`)과 맞춘다.
    case "datetime":
      return now.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}
