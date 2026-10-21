"use client";

import { useState, type ReactNode } from "react";

import { useReportUnsaved, useSave } from "@/app/_lib/unsaved";
import type { NewPostSubmenu } from "@/lib/content/create-post";
import type { PostActions } from "@/lib/content/save-flow";
import { newPostPreviewPath } from "@/lib/content/slug";
import { newPostChanges } from "@/lib/content/unsaved";
import type { Collection } from "@/lib/editor-config";

import { MetadataSettings, MetadataTitleInput, useMetadataTitle } from "../post/metadata-form";
import { PostActionBar } from "../post/post-actions";
import { usePostEditor } from "../post/post-editor";
import type { NewPostSaveInput } from "./actions";
import type { CreateState } from "./create-result";

const inputClass = "rounded border px-2 py-1 text-sm disabled:opacity-60";

// 폴더 이름에 쓸 수 없는 `/`로 시작해 기존 하위 메뉴 이름과 겹치지 않는다.
const NEW_MENU = "/new";

/**
 * 새 글 화면의 입력. 글 화면과 같은 제목 입력·본문(`children`)·글 설정·저장 버튼에 하위 메뉴 선택을 더한다.
 * 입력만으로는 저장하지 않고 ‘임시저장’·‘게시’를 눌러야 글 전체와 새 하위 메뉴를 한 번에 저장한다.
 */
export function NewPostForm({
  collection,
  submenus,
  actions,
  save,
  cancelHref,
  children,
}: {
  collection: Collection;
  /** 하위 메뉴가 있는 컬렉션이면 고를 수 있는 기존 하위 메뉴. 아직 없으면 빈 배열. 하위 메뉴가 없는 컬렉션이면 null. */
  submenus: string[] | null;
  actions: PostActions;
  save: (input: NewPostSaveInput, data: FormData) => Promise<CreateState>;
  /** ‘작성 취소’를 확인하면 입력을 버리고 갈 글 목록. */
  cancelHref: string;
  children: ReactNode;
}) {
  const { mode } = usePostEditor();
  const title = useMetadataTitle();
  // 기존 메뉴가 없으면 고를 것이 없으니 새 메뉴 이름부터 받는다.
  const [initial] = useState<NewPostSubmenu>({ kind: submenus?.length ? "existing" : "new", name: "" });
  const [submenu, setSubmenu] = useState(initial);
  const changes = newPostChanges({ title: "", submenu: initial }, { title, submenu });
  // 원문 편집에서는 제목도 원문이 담아, 제목 칸의 숨은 입력은 원문 편집으로 넘어간 것이다.
  useReportUnsaved("title", changes.title && mode === "wysiwyg");
  useReportUnsaved("submenu", submenus !== null && changes.submenu);
  const path = newPostPreviewPath(collection, title, submenus ? submenu.name : undefined);

  return (
    <>
      {submenus && <SubmenuField submenus={submenus} value={submenu} onChange={setSubmenu} />}
      <div className="flex flex-col gap-1">
        <MetadataTitleInput />
        <p hidden={mode === "source"} className="text-xs break-all text-zinc-500">
          경로 {path}
        </p>
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">본문</h2>
        {children}
      </section>
      <section className="flex flex-col gap-2">
        <MetadataSettings />
      </section>
      <PostActionBar
        target="new"
        actions={actions}
        title={title}
        save={(input, data) => save({ ...input, submenu: submenus ? submenu : undefined }, data)}
        cancelHref={cancelHref}
      />
    </>
  );
}

/** 기존 하위 메뉴를 고르거나 ‘새 메뉴’를 골라 이름을 입력한다. 새 메뉴는 글을 저장할 때 함께 만든다. */
function SubmenuField({
  submenus,
  value,
  onChange,
}: {
  submenus: string[];
  value: NewPostSubmenu;
  onChange: (value: NewPostSubmenu) => void;
}) {
  const save = useSave("new");
  const error = save.state.status === "error" ? save.state.fields?.submenu : undefined;
  const label = (
    <span className="text-sm font-medium">
      하위 메뉴<span className="text-red-600"> *</span>
    </span>
  );
  const nameInput = (
    <input
      type="text"
      value={value.name}
      disabled={save.locked}
      onChange={(event) => onChange({ kind: "new", name: event.target.value })}
      className={inputClass}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      {submenus.length === 0 ? (
        <>
          <label className="flex flex-col gap-1">
            {label}
            {nameInput}
          </label>
          <span className="text-xs text-zinc-500">
            아직 하위 메뉴가 없어요. 새 메뉴 이름을 입력하면 이 글을 저장할 때 함께 만들어요.
          </span>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            {label}
            <select
              value={value.kind === "new" ? NEW_MENU : value.name}
              disabled={save.locked}
              onChange={(event) =>
                onChange(
                  event.target.value === NEW_MENU
                    ? { kind: "new", name: "" }
                    : { kind: "existing", name: event.target.value },
                )
              }
              className={`${inputClass} w-fit`}
            >
              <option value="" disabled>
                (선택)
              </option>
              {submenus.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={NEW_MENU}>새 메뉴</option>
            </select>
          </label>
          {value.kind === "new" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-sm">새 메뉴 이름</span>
                {nameInput}
              </label>
              <span className="text-xs text-zinc-500">새 메뉴는 이 글을 저장할 때 함께 만들어요.</span>
            </>
          )}
        </>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
