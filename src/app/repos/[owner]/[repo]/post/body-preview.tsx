"use client";

import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 미리보기 메시지만 가져온다.
import { previewOrigin, trustsPreviewMessage, type PreviewMessage } from "@/lib/content/preview";
import { TechDetails } from "@/app/_lib/ui";
import { previewMdx, type PreviewImages, type Syntax } from "@/lib/mdx-doc";

import { TOGGLE_BUTTON_CLASS } from "./editor-mode-switch";

/** 입력이 이만큼 멈추면 사이트 미리보기에 다시 보낸다. 사이트가 글 전체를 다시 컴파일하므로 입력마다 보내지 않는다. */
const SITE_PREVIEW_DELAY = 500;

/** config `preview`가 있는 사이트의 미리보기. `message`는 보낼 때마다 불러 그 시점의 원문을 담는다. */
export type SitePreview = { url: string; message: () => PreviewMessage };

/**
 * 편집 중인 MDX를 미리 그려 보는 미리보기. 누르면 열리고, 열린 동안 입력을 따라 다시 그린다.
 * `site`가 있으면 사이트의 미리보기 페이지를 띄우고, 없으면 에디터 안에서 마크다운으로 그린다.
 */
export function BodyPreview({
  markdown,
  syntax,
  images,
  site,
}: {
  markdown: string;
  syntax: Syntax;
  /** 그림으로 보일 이미지. import 변수명 → 이미지 주소. */
  images?: PreviewImages;
  site?: SitePreview;
}) {
  const [open, setOpen] = useState(false);
  const origin = site && previewOrigin(site.url);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-pressed={open}
        onClick={() => setOpen(!open)}
        className={`w-fit ${TOGGLE_BUTTON_CLASS}`}
      >
        미리보기
      </button>
      {open &&
        (site && origin ? (
          <SiteFrame url={site.url} origin={origin} message={site.message} markdown={markdown} />
        ) : (
          <Preview markdown={markdown} syntax={syntax} images={images} />
        ))}
    </div>
  );
}

function SiteFrame({
  url,
  origin,
  message,
  markdown,
}: {
  url: string;
  origin: string;
  message: () => PreviewMessage;
  /** 바뀌면 입력이 멈춘 뒤 다시 보낸다. */
  markdown: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);

  const send = useEffectEvent(() => {
    if (ready.current) frame.current?.contentWindow?.postMessage(message(), origin);
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // 같은 origin의 다른 창이 보낸 메시지까지 받지 않도록 이 iframe에서 온 것인지도 본다.
      if (event.source !== frame.current?.contentWindow || !trustsPreviewMessage(url, event.origin)) return;
      if (event.data?.type !== "preview-ready") return;
      ready.current = true;
      send();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [url]);

  useEffect(() => {
    const timer = setTimeout(send, SITE_PREVIEW_DELAY);
    return () => clearTimeout(timer);
  }, [markdown]);

  return (
    <>
      <p className="text-xs text-zinc-500">사이트의 미리보기 페이지로 보여 줘요. 입력을 멈추면 다시 그려요.</p>
      <iframe ref={frame} src={url} title="사이트 미리보기" className="h-[70vh] w-full rounded border" />
    </>
  );
}

function Preview({ markdown, syntax, images }: { markdown: string; syntax: Syntax; images?: PreviewImages }) {
  // 긴 글에서 입력이 밀리지 않도록 그리기는 입력보다 늦게 따라간다.
  // images에 기본값 객체를 두면 렌더마다 참조가 바뀌어 useMemo가 매번 다시 파싱하므로 undefined 그대로 넘긴다.
  const deferred = useDeferredValue(markdown);
  const preview = useMemo(() => previewMdx(deferred, syntax, images), [deferred, syntax, images]);

  if (!preview.ok) {
    return (
      <>
        <p className="text-sm text-amber-600">
          글에 문법 오류가 있어 미리보기를 그릴 수 없어요. 원문 편집의 오류 표시를 보고 고쳐 주세요.
        </p>
        <TechDetails items={[["오류 원문", preview.message]]} />
      </>
    );
  }
  return (
    <>
      <p className="text-xs text-zinc-500">사이트 컴포넌트는 이름과 속성만 보여요.</p>
      <div className="body-preview rounded border">{toJsxRuntime(preview.tree, { Fragment, jsx, jsxs })}</div>
    </>
  );
}
