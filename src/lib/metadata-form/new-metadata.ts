import type { Collection, MetadataField } from "@/lib/editor-config";
import type { MetadataValue } from "@/lib/mdx-doc";

import { datetimeNow } from "./datetime";
import { set, type MetadataObject } from "./form";
import { STATUS_FIELD } from "./labels";
import type { PostStatus } from "./status";

const DRAFT: PostStatus = "draft";

/**
 * 새 글의 metadata. `title`을 맨 앞에 두고 config에 적힌 필드를 순서대로 기본값으로 채운다.
 * 기존 글처럼 빈 description·keywords도 키를 둔다. 사이트가 키가 있다고 보고 읽을 수 있어서다.
 */
export function newMetadata(collection: Collection, title: string, now: Date): MetadataObject {
  const metadata: MetadataObject = { title };
  for (const [key, field] of Object.entries(collection.metadata)) {
    if (key === "title") continue;
    set(metadata, key, defaultValue(key, field, now));
  }
  return metadata;
}

function defaultValue(key: string, field: MetadataField, now: Date): MetadataValue {
  switch (field.type) {
    case "string":
    case "text":
      return "";
    case "string[]":
      return [];
    // 게시 상태는 첫 선택지와 관계없이 초안이다. yjshd·blog는 ["ready", "draft"]라 첫 선택지면 만든 글이 바로 게시 대상이 된다.
    // 초안이 없는 설정은 상태를 다룰 수 없어 저장에서 막으므로 첫 선택지로 둔다.
    case "select":
      return key === STATUS_FIELD && field.options.includes(DRAFT) ? DRAFT : field.options[0]!;
    case "datetime":
      return datetimeNow(now);
  }
}
