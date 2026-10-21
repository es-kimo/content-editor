import { TechDetails } from "@/app/_lib/ui";
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
