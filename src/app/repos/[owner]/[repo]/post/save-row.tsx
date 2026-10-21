import { PRIMARY_BUTTON_CLASS, TechDetails } from "@/app/_lib/ui";
import { FormBlockedNotice, type useSave } from "@/app/_lib/unsaved";
import type { SaveState } from "@/lib/content/save-flow";

/** 저장 결과. 실패하면 이유와 할 일을 기본 화면에, 오류 원문을 기술 상세에 둔다. */
export function SaveResultNotice({ state }: { state: SaveState }) {
  return (
    <>
      {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      {state.status === "unchanged" && <p className="text-sm text-zinc-500">변경된 내용이 없어요.</p>}
      {state.status === "error" && state.detail && <TechDetails items={[["오류 원문", state.detail]]} />}
    </>
  );
}

/** 새 글 화면의 저장 버튼과 저장 결과. */
export function SaveRow({
  label,
  save,
}: {
  label: string;
  /** `useSave`의 결과. 저장 중이면 누를 수 없다. 적용하지 않은 폼 때문에 막은 저장이면 폼을 먼저 닫으라고 안내한다. */
  save: Pick<ReturnType<typeof useSave>, "state" | "pending" | "locked" | "formBlocked">;
}) {
  const { state, pending, locked, formBlocked } = save;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button type="submit" disabled={locked} className={PRIMARY_BUTTON_CLASS}>
          {pending ? "저장 중…" : label}
        </button>
        {formBlocked === "save-draft" && <FormBlockedNotice />}
      </div>
      <SaveResultNotice state={state} />
    </div>
  );
}
