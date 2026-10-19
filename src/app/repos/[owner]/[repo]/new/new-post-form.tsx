"use client";

import { startTransition, useActionState, useState } from "react";

import { postSlug } from "@/lib/content/slug";

import { SaveRow } from "../post/save-row";
import type { CreateState } from "./actions";

const inputClass = "rounded border px-2 py-1 text-sm";

export function NewPostForm({
  folder,
  submenus,
  action,
}: {
  /** 글 폴더가 들어갈 경로. 입력한 제목으로 만들 폴더 이름 앞에 보인다. */
  folder: string;
  /** 하위 메뉴가 있는 컬렉션이면 고를 수 있는 하위 메뉴. 없으면 null. */
  submenus: string[] | null;
  action: (state: CreateState, data: FormData) => Promise<CreateState>;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const [title, setTitle] = useState("");
  const [submenu, setSubmenu] = useState("");
  const fieldErrors = state.status === "error" ? (state.fields ?? {}) : {};
  const slug = postSlug(title);

  return (
    <form
      className="flex flex-col gap-4"
      // form action은 제출 뒤 입력을 초기화한다. 만들기가 실패해도 입력이 남게 직접 보낸다.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
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
        <span className="text-xs break-all text-zinc-500">
          폴더 {folder}/{submenus && `${submenu || "(하위 메뉴)"}/`}
          {slug ?? "(제목을 입력한다)"}
        </span>
        {fieldErrors.title && <span className="text-xs text-red-600">{fieldErrors.title}</span>}
      </label>
      <SaveRow label="만들기" pending={pending} state={state} />
    </form>
  );
}
