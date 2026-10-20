import { PRIMARY_BUTTON_CLASS, TechDetails } from "@/app/_lib/ui";
import type { SaveState } from "@/lib/content/save-flow";

/** 글 화면 편집 영역과 새 글 화면의 저장 버튼과 저장 결과. */
export function SaveRow({
  label,
  save,
  disabled = false,
}: {
  label: string;
  /** `useSave`의 결과. 이 영역이 저장 중이거나 다른 저장이 진행·확인 중이면 누를 수 없다. */
  save: { state: SaveState; pending: boolean; locked: boolean };
  /** 저장 중이 아니어도 지금은 저장할 수 없을 때. 이유는 호출자가 옆에 보인다. */
  disabled?: boolean;
}) {
  const { state, pending, locked } = save;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button type="submit" disabled={locked || disabled} className={PRIMARY_BUTTON_CLASS}>
          {pending ? "저장 중…" : label}
        </button>
        {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
        {state.status === "unchanged" && <p className="text-sm text-zinc-500">변경된 내용이 없어요.</p>}
      </div>
      {state.status === "error" && state.detail && <TechDetails items={[["오류 원문", state.detail]]} />}
    </div>
  );
}
