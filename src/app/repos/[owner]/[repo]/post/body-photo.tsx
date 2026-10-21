"use client";

import { useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";
import type { BodyImagePhoto } from "@/lib/content/body-image";

/**
 * 일반 편집 본문의 이미지 한 곳을 사진으로 그린다. 사이트 컴포넌트를 실행하지 않는 편집용 표현이다.
 * 주소가 바뀌면 처음부터 다시 불러오도록 부르는 쪽이 주소를 key로 둔다.
 * @param inline 문장 안의 이미지. 문단 안에 블록 요소를 둘 수 없어 span으로 그린다.
 */
export function BodyPhoto({ photo, inline }: { photo: BodyImagePhoto; inline: boolean }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  // 다시 불러오면 img를 새로 만들어 브라우저가 다시 요청하게 한다.
  const [attempt, setAttempt] = useState(0);
  const Box = inline ? "span" : "div";
  const alt = photo.alt === "" ? "대체 텍스트 없음" : `대체 텍스트: ${photo.alt}`;

  return (
    <Box className="inline-flex max-w-full flex-col gap-1 align-top">
      {state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- 세션 쿠키로 읽는 라우트와 blob 주소라 이미지 최적화를 거칠 수 없다
        <img
          key={attempt}
          src={photo.src}
          alt={photo.alt}
          className={`h-auto max-w-full ${state === "loading" ? "hidden" : ""}`}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      )}
      {state === "loading" && <span className="text-sm text-zinc-500">사진을 불러오는 중…</span>}
      {state === "failed" && (
        <>
          <span className="text-sm text-amber-600">사진을 불러오지 못했어요. {alt}</span>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => {
              setState("loading");
              setAttempt(attempt + 1);
            }}
          >
            다시 불러오기
          </button>
        </>
      )}
    </Box>
  );
}
