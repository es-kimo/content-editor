"use client";

import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { useDeferredValue, useMemo, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import { previewMdx, type PreviewImages, type Syntax } from "@/lib/mdx-doc";

/** 편집 중인 MDX를 마크다운으로 그려 보는 미리보기. 누르면 열리고, 열린 동안 입력을 따라 다시 그린다. */
export function BodyPreview({
  markdown,
  syntax,
  images = {},
}: {
  markdown: string;
  syntax: Syntax;
  /** 그림으로 보일 이미지. import 변수명 → 이미지 주소. */
  images?: PreviewImages;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-pressed={open}
        onClick={() => setOpen(!open)}
        className="w-fit rounded border px-3 py-1 text-sm aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black"
      >
        미리보기
      </button>
      {open && <Preview markdown={markdown} syntax={syntax} images={images} />}
    </div>
  );
}

function Preview({ markdown, syntax, images }: { markdown: string; syntax: Syntax; images: PreviewImages }) {
  // 긴 글에서 입력이 밀리지 않도록 그리기는 입력보다 늦게 따라간다.
  const deferred = useDeferredValue(markdown);
  const preview = useMemo(() => previewMdx(deferred, syntax, images), [deferred, syntax, images]);

  if (!preview.ok) {
    return (
      <p className="text-sm text-amber-600">
        MDX 문법 오류가 있어 미리보기를 그릴 수 없다. 원문 모드의 오류 표시를 보고 고친다: {preview.message}
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-zinc-500">사이트 컴포넌트는 이름과 속성만 보인다.</p>
      <div className="body-preview rounded border">{toJsxRuntime(preview.tree, { Fragment, jsx, jsxs })}</div>
    </>
  );
}
