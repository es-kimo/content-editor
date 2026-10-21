"use client";

import { useState } from "react";

import { useReportUnsaved, useSave } from "@/app/_lib/unsaved";
import { newPostPath, postSlug } from "@/lib/content/slug";
import { newPostChanges, type NewPostInput } from "@/lib/content/unsaved";
import type { Collection } from "@/lib/editor-config";

import { SaveRow } from "../post/save-row";
import type { CreateState } from "./create-result";

const inputClass = "rounded border px-2 py-1 text-sm disabled:opacity-60";
const INITIAL: NewPostInput = { title: "", submenu: { kind: "existing", name: "" } };

export function NewPostForm({
  collection,
  submenus,
  action,
}: {
  collection: Collection;
  /** 하위 메뉴가 있는 컬렉션이면 고를 수 있는 하위 메뉴. 없으면 null. */
  submenus: string[] | null;
  action: (data: FormData) => Promise<CreateState>;
}) {
  const save = useSave("new");
  const [title, setTitle] = useState(INITIAL.title);
  const [submenu, setSubmenu] = useState(INITIAL.submenu.name);
  const changes = newPostChanges(INITIAL, { title, submenu: { kind: "existing", name: submenu } });
  useReportUnsaved("title", changes.title);
  useReportUnsaved("submenu", changes.submenu);
  const fieldErrors = save.state.status === "error" ? (save.state.fields ?? {}) : {};
  // 아직 입력하지 않은 자리는 자리 이름으로 채워, 만들 글이 어디에 생길지 처음부터 보여 준다.
  const path = newPostPath(collection, postSlug(title) ?? "(제목)", submenus ? submenu || "(하위 메뉴)" : undefined);

  return (
    <form
      // form action은 제출 뒤 입력을 초기화한다. 만들기가 실패해도 입력이 남게 직접 보낸다.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        save.request({ target: "new", action: "save-draft", mode: "wysiwyg" }, () => action(data));
      }}
    >
      {/* 만드는 중에는 입력을 막는다. 막힌 입력은 제출되지 않지만 제출할 값은 막기 전에 읽어 두었다. */}
      <fieldset disabled={save.locked} className="flex flex-col gap-4">
        {submenus && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              하위 메뉴<span className="text-red-600"> *</span>
            </span>
            <select
              name="submenu"
              required
              value={submenu}
              onChange={(event) => setSubmenu(event.target.value)}
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
            </select>
            {fieldErrors.submenu && <span className="text-xs text-red-600">{fieldErrors.submenu}</span>}
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            제목<span className="text-red-600"> *</span>
          </span>
          <input
            type="text"
            name="title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
          />
          <span className="text-xs break-all text-zinc-500">경로 {path}</span>
          {fieldErrors.title && <span className="text-xs text-red-600">{fieldErrors.title}</span>}
        </label>
        <SaveRow label="만들기" save={save} />
      </fieldset>
    </form>
  );
}
