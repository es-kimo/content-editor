"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";
import type { SaveState } from "@/lib/content/save-flow";

import { SaveResultNotice } from "./save-row";

/**
 * 휴지통 글의 ‘복구’. 복구하면 초안이 된 글 화면으로 간다. 실패하면 이유를 버튼 아래에 보인다.
 * 화면 입력이 없어 확인 없이 바로 한다.
 */
export function RestoreButton({
  restore,
  primary = false,
}: {
  restore: () => Promise<SaveState>;
  /** 휴지통 글 화면처럼 이 버튼이 그 화면의 주 행동인지. */
  primary?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      let result: SaveState;
      try {
        result = await restore();
      } catch {
        result = { status: "error", message: "복구하지 못했어요. 연결을 확인한 뒤 다시 복구해 주세요." };
      }
      setState(result);
      if (result.status === "saved") router.push(result.href);
    });

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending || state.status === "saved"}
        onClick={run}
        className={primary ? PRIMARY_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
      >
        {pending || state.status === "saved" ? "복구 중…" : "복구"}
      </button>
      <SaveResultNotice state={state} />
    </div>
  );
}
