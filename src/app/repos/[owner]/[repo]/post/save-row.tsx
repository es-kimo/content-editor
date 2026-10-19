import { PRIMARY_BUTTON_CLASS } from "@/app/_lib/ui";

import type { SaveState } from "./actions";

/** 글 화면 편집 영역과 새 글 화면의 저장 버튼과 저장 결과. */
export function SaveRow({
  label,
  pending,
  state,
  unchanged,
}: {
  label: string;
  pending: boolean;
  state: SaveState;
  /** 바뀐 것이 없어 커밋하지 않았을 때의 안내. 새 글처럼 그런 결과가 없으면 비워 둔다. */
  unchanged?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS}>
        {pending ? "저장 중…" : label}
      </button>
      {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      {state.status === "unchanged" && <p className="text-sm text-zinc-500">{unchanged}</p>}
    </div>
  );
}
