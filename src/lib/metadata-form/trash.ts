import { lookupMetadata } from "@/lib/mdx-doc";

import { datetimeNow } from "./datetime";
import { remove, set, type MetadataObject } from "./form";
import { TRASHED_AT_FIELD } from "./labels";
import { withStatus } from "./status";

/** 글의 휴지통 표시. 키만 있고 시각으로 읽을 수 없어도 휴지통 글로 본다. 일반 목록에 섞이지 않게 하려는 것이다. */
export type TrashState = { trashed: false } | { trashed: true; trashedAt: string | null };

export function readTrash(metadata: MetadataObject): TrashState {
  const found = lookupMetadata(metadata, TRASHED_AT_FIELD);
  if (found.kind !== "found") return { trashed: false };
  return { trashed: true, trashedAt: typeof found.value === "string" ? found.value : null };
}

/**
 * 휴지통에 옮긴 새 metadata. 상태를 `draft`로 두고 `now`를 삭제 시각으로 적는다. 다른 키와 키 순서는 그대로다.
 * 상태를 담을 `other`가 객체가 아니면 null (`withStatus`).
 */
export function withTrash(metadata: MetadataObject, now: Date): MetadataObject | null {
  const next = withStatus(metadata, "draft");
  if (!next) return null;
  set(next, TRASHED_AT_FIELD, datetimeNow(now));
  return next;
}

/** 휴지통에서 꺼낸 새 metadata. 삭제 시각을 빼고, 옮기기 전에 게시 대상이었어도 상태는 `draft`다. */
export function withoutTrash(metadata: MetadataObject): MetadataObject | null {
  const next = withStatus(metadata, "draft");
  if (!next) return null;
  remove(next, TRASHED_AT_FIELD);
  return next;
}
