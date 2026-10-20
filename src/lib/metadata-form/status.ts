import type { Collection } from "@/lib/editor-config";
import { lookupMetadata } from "@/lib/mdx-doc";

import { set, type MetadataObject } from "./form";
import { STATUS_FIELD } from "./labels";

/** 에디터가 다루는 게시 상태. `draft`는 초안, `ready`는 게시 대상이다. */
export type PostStatus = "draft" | "ready";

/** 상태를 정하는 명시적 행동. 초안은 `save-draft`·`publish`, 게시 대상 글은 `update`·`unpublish`를 한다. */
export type PostAction = "save-draft" | "publish" | "update" | "unpublish";

export type StatusProblem =
  /** config에 `other.status` select가 없다. */
  | "status-field"
  /** `other.status`의 선택지에 `draft`와 `ready`가 모두 있지 않다. */
  | "status-options"
  /** 글의 상태가 `draft`·`ready`가 아니다 (없음, 다른 값, 리터럴이 아님). */
  | "status-value"
  /** 글의 지금 상태에서 할 수 없는 행동이다. */
  | "action";

export type ActionStatus = { ok: true; status: PostStatus } | { ok: false; reason: StatusProblem };

const STATUSES: readonly PostStatus[] = ["draft", "ready"];

/** 행동마다 할 수 있는 상태와 저장할 상태. */
const ACTIONS: { [action in PostAction]: { from: PostStatus; to: PostStatus } } = {
  "save-draft": { from: "draft", to: "draft" },
  publish: { from: "draft", to: "ready" },
  update: { from: "ready", to: "ready" },
  unpublish: { from: "ready", to: "draft" },
};

/** 컬렉션이 게시 상태를 다룰 수 있는지. 다룰 수 없으면 설정을 고쳐야 하므로 이유를 구분한다. */
export function statusSupport(
  collection: Collection,
): { ok: true } | { ok: false; reason: Extract<StatusProblem, "status-field" | "status-options"> } {
  const field = Object.hasOwn(collection.metadata, STATUS_FIELD) ? collection.metadata[STATUS_FIELD] : undefined;
  if (field?.type !== "select") return { ok: false, reason: "status-field" };
  if (!STATUSES.every((status) => field.options.includes(status))) return { ok: false, reason: "status-options" };
  return { ok: true };
}

/** 글 metadata의 게시 상태. 알 수 없는 값을 게시 대상으로 넘겨짚지 않도록 `draft`·`ready`가 아니면 null. */
export function readStatus(metadata: MetadataObject): PostStatus | null {
  const found = lookupMetadata(metadata, STATUS_FIELD);
  if (found.kind !== "found") return null;
  return STATUSES.find((status) => status === found.value) ?? null;
}

/** 상태만 `status`로 바꾼 새 metadata. 다른 키와 키 순서는 그대로 둔다. */
export function withStatus(metadata: MetadataObject, status: PostStatus): MetadataObject {
  const next = structuredClone(metadata);
  set(next, STATUS_FIELD, status);
  return next;
}

/**
 * 지금 상태의 글에 행동을 할 수 있는지와 저장할 상태. 설정 → 글의 상태 → 행동 순으로 확인한다.
 * @param current `readStatus`의 결과. 아직 저장하지 않은 새 글은 `draft`로 넘긴다.
 */
export function actionStatus(collection: Collection, current: PostStatus | null, action: PostAction): ActionStatus {
  const support = statusSupport(collection);
  if (!support.ok) return support;
  if (current === null) return { ok: false, reason: "status-value" };
  const rule = ACTIONS[action];
  if (rule.from !== current) return { ok: false, reason: "action" };
  return { ok: true, status: rule.to };
}
