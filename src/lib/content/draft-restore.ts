// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { Collection } from "@/lib/editor-config";
import { parseMdx, readMetadata, type MdxDoc, type Syntax } from "@/lib/mdx-doc";
import { fieldLabel, TITLE_FIELD } from "@/lib/metadata-form";

import type { NewPostSubmenu } from "./create-post";
import { checkRestore, DRAFT_TTL_DAYS, type Draft, type DraftAttachment } from "./draft";
import type { FormModeInput, SourceModeInput, SwitchPost } from "./mode-switch";
import { koreaTimeText, postTitle, UNTITLED_POST } from "./summary";
import { applyUploads } from "./upload";

/**
 * 보관본을 편집기에 다시 열 입력. 편집기를 이 입력으로 열기만 하고 저장하거나 게시하지 않는다.
 * 일반 편집의 `doc`은 연 원문에 보관한 첨부의 import를 더한 것이고, `missing`은 본문이 가리키지만 파일이 없어
 * 다시 골라야 하는 첨부 이름이다.
 */
export type RestoredInput =
  | {
      mode: "wysiwyg";
      input: FormModeInput<DraftAttachment>;
      doc: MdxDoc;
      missing: string[];
      submenu?: NewPostSubmenu;
    }
  | { mode: "source"; input: SourceModeInput<DraftAttachment>; submenu?: NewPostSubmenu };

/**
 * 보관본을 지금 글 편집기에 열 입력으로 바꾼다. 보관한 모드 그대로 연다.
 * 기준 글이 같을 때(`checkRestore`의 `restorable`)만 부른다. 첨부 이름이 연 글 폴더 파일과 겹치지 않는다고 본다.
 */
export function restoreDraft(post: SwitchPost, draft: Pick<Draft, "input" | "attachments" | "missing">): RestoredInput {
  const { input, attachments, missing } = draft;
  const submenu = input.submenu ? { submenu: input.submenu } : {};
  if (input.mode === "source")
    return { mode: "source", input: { source: input.source, images: attachments }, ...submenu };
  const opened = parseMdx(post.source, post.syntax);
  // 보관한 첨부는 본문이 쓰는 것만 담아 이을 수 있다. 잇지 못하면 첨부 없이 본문만 열고, 그 첨부도 다시 골라야 한다.
  const applied = applyUploads(opened, input.body, attachments, post.files);
  return {
    mode: "wysiwyg",
    input: { values: input.values, body: input.body, images: applied.ok ? attachments : [] },
    doc: applied.ok ? applied.doc : opened,
    missing: applied.ok ? missing : [...missing, ...attachments.map(({ file }) => file)],
    ...submenu,
  };
}

/** 복구 안내의 행동. */
export type DraftAction = "restore" | "discard" | "copy";

export const DRAFT_ACTION_LABELS: { [action in DraftAction]: string } = {
  restore: "복구",
  discard: "버리기",
  copy: "보관 내용 복사",
};

/** 복구 안내에 늘 함께 두는 보관 기간과 보장 범위. */
export const DRAFT_RESTORE_LIMIT =
  `보관한 입력은 마지막으로 보관한 뒤 ${DRAFT_TTL_DAYS}일이 지나면 지워져요. ` +
  "다른 기기나 다른 브라우저, 브라우저 데이터를 지운 뒤에는 복구할 수 없어요.";

/**
 * 복구 안내에 보일 보관본 하나. `target`은 무엇을 보관했는지, `archived`는 복사할 보관 내용이다.
 * 기준 글이 같으면 ‘복구’·‘버리기’를 둔다. 기준이 바뀌었거나 휴지통 글이면 복구하지 않고 지금 글과 비교해 복사하게 한다.
 */
export type DraftChoice = {
  draft: Draft;
  message: string;
  target: string;
  archived: string;
} & (
  | { kind: "restorable"; actions: ["restore", "discard"] }
  | { kind: "conflict"; reason: "changed" | "trashed"; actions: ["copy", "discard"] }
);

/**
 * 다시 연 화면에 보일 보관본 선택지. 최근 보관 순(`listDrafts`)을 그대로 둔다.
 * @param current 지금 원격 글. 새 글이면 null.
 */
export function draftChoices(
  drafts: Draft[],
  current: { sha: string; trashed: boolean } | null,
  post: { collection: Collection; syntax: Syntax },
): DraftChoice[] {
  return drafts.map((draft) => {
    const restore = checkRestore(draft, current);
    const saved = `${koreaTimeText(draft.savedAt)}에 이 브라우저에 보관한 입력이 있어요.`;
    const missing =
      draft.missing.length > 0
        ? ` 이미지 ${draft.missing.length}개(${draft.missing.join(", ")})는 보관하지 못했어요. 복구한 뒤 이미지를 다시 골라 주세요.`
        : "";
    const common = { draft, target: draftTarget(draft, post.syntax), archived: archivedText(draft, post.collection) };
    if (restore.kind === "restorable") {
      return { ...common, kind: "restorable", message: saved + missing, actions: ["restore", "discard"] };
    }
    return {
      ...common,
      kind: "conflict",
      reason: restore.reason,
      message: saved + CONFLICT_MESSAGES[restore.reason] + missing,
      actions: ["copy", "discard"],
    };
  });
}

const CONFLICT_MESSAGES: { [reason in "changed" | "trashed"]: string } = {
  changed: " 보관한 뒤 다른 곳에서 글이 바뀌어 바로 복구하지 않아요. 지금 글과 비교해 필요한 내용을 복사해 주세요.",
  trashed: " 글이 휴지통에 있어 바로 복구하지 않아요. 보관한 내용을 복사해 두고 글을 복구한 뒤 옮겨 주세요.",
};

/** 보관한 글 제목과 편집 모드. 새 글 보관본이 여럿이어도 구분할 수 있게 한다. */
function draftTarget(draft: Draft, syntax: Syntax): string {
  const { input } = draft;
  if (input.mode === "form") return `‘${input.values[TITLE_FIELD] || UNTITLED_POST}’ · 일반 편집 입력`;
  return `‘${postTitle(readMetadata(parseMdx(input.source, syntax)))}’ · 원문 편집 입력`;
}

/** 복사할 보관 내용. 원문 편집은 원문 그대로, 일반 편집은 글 설정 값을 한 줄씩 적고 빈 줄 뒤에 본문을 둔다. */
function archivedText(draft: Draft, collection: Collection): string {
  const { input } = draft;
  if (input.mode === "source") return input.source;
  const settings = Object.entries(input.values).map(
    ([key, value]) => `${fieldLabel(key, collection.metadata[key]?.label)}: ${value}`,
  );
  return [...settings, "", input.body].join("\n");
}
