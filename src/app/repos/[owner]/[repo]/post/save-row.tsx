import type { SaveState } from "./actions";

/** 글 화면 편집 영역의 저장 버튼과 저장 결과. */
export function SaveRow({
  label,
  pending,
  state,
  unchanged,
}: {
  label: string;
  pending: boolean;
  state: SaveState;
  /** 바뀐 것이 없어 커밋하지 않았을 때의 안내. */
  unchanged: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-black px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? "저장 중…" : label}
      </button>
      {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      {state.status === "unchanged" && <p className="text-sm text-zinc-500">{unchanged}</p>}
    </div>
  );
}
