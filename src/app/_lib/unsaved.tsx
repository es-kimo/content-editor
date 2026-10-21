"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { LeaveGuardProvider } from "@/app/_lib/leave";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 미저장 판정과 저장 흐름만 가져온다.
import { leavingAreas } from "@/lib/content/leave-guard";
import {
  createSaveFlow,
  type FormArea,
  type SaveFlow,
  type SaveRequest,
  type SaveState,
  type SaveTarget,
} from "@/lib/content/save-flow";
import { unsavedAreas, type EditArea } from "@/lib/content/unsaved";

const SaveFlowContext = createContext<SaveFlow | null>(null);

/**
 * 화면의 편집 영역들이 알린 미저장 변경과 저장을 모으고, 미저장 입력을 잃는 이동 전에 묻는다.
 * @param revision 저장한 글 화면이 열릴 때마다 바뀌는 값(`saved` 커밋). 바뀌면 저장 뒤 막아 둔 입력을 다시 받는다.
 */
export function UnsavedProvider({ revision, children }: { revision?: string; children: ReactNode }) {
  // 버리고 나간 화면은 숨겨진 채 남아 있다가 돌아오면 그대로 보인다(cacheComponents의 Activity).
  // 숨겨질 때 편집 영역과 저장 상태를 처음부터 다시 열어 버린 입력이 돌아오지 않게 한다.
  const [opened, setOpened] = useState(0);
  const discarded = useCallback(() => setOpened((count) => count + 1), []);
  return (
    <UnsavedScope key={opened} revision={revision} onDiscarded={discarded}>
      {children}
    </UnsavedScope>
  );
}

function UnsavedScope({
  revision,
  onDiscarded,
  children,
}: {
  revision?: string;
  onDiscarded: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [flow] = useState(() => createSaveFlow({ navigate: (href) => router.push(href) }));
  useEffect(() => {
    const settled = flow.settle();
    // 게시 내리기는 미저장 편집을 버리기로 하고 한 것이다. 바뀌지 않은 본문의 편집기는 key가 같아 남으므로 모두 다시 연다.
    if (settled?.target === "post" && settled.action === "unpublish") onDiscarded();
  }, [flow, revision, onDiscarded]);
  return (
    <SaveFlowContext value={flow}>
      <LeaveGuardProvider areas={() => leavingAreas(flow.getState())} onDiscarded={onDiscarded}>
        {children}
      </LeaveGuardProvider>
    </SaveFlowContext>
  );
}

function useFlow(): SaveFlow {
  const flow = useContext(SaveFlowContext);
  if (!flow) throw new Error("UnsavedProvider 안에서만 쓴다.");
  return flow;
}

const useFlowState = (flow: SaveFlow) => useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);

/** 편집 영역의 미저장 여부를 화면에 알린다. 영역이 사라지면 변경도 거둔다. */
export function useReportUnsaved(area: EditArea, changed: boolean) {
  const flow = useFlow();
  useEffect(() => {
    flow.report(area, changed);
    return () => flow.report(area, false);
  }, [flow, area, changed]);
}

/** 편집 영역들이 알린 미저장 변경. */
export function useUnsavedChanged(): { [area in EditArea]?: boolean } {
  return useFlowState(useFlow()).changed;
}

/** 편집 영역이 이미지를 준비하는 중인지 알린다. 영역이 사라지면 함께 거둔다. */
export function useReportPreparing(area: FormArea, preparing: boolean) {
  const flow = useFlow();
  useEffect(() => {
    flow.prepare(area, preparing);
    return () => flow.prepare(area, false);
  }, [flow, area, preparing]);
}

/** 어느 편집 영역이든 이미지를 준비하는 중이면 true. */
export function useImagePreparing(): boolean {
  return Object.values(useFlowState(useFlow()).preparing).some(Boolean);
}

/** 저장이 진행 중이면 true. 그동안 입력·첨부·모드 전환·다른 저장·폼 열기를 막는다. */
export function useSaveLocked(): boolean {
  return useFlowState(useFlow()).phase.kind !== "idle";
}

const IDLE: SaveState = { status: "idle" };

/** 저장 대상 하나의 저장 버튼 상태와 제출. 제출은 `SaveFlow.request`를 따른다. */
export function useSave(target: SaveTarget) {
  const flow = useFlow();
  const { phase, results, form } = useFlowState(flow);
  return {
    state: results[target] ?? IDLE,
    /** 이 대상의 진행 중인 저장. 성공한 뒤 저장한 글 화면이 열릴 때까지도 저장 중이다. */
    pending: phase.kind !== "idle" && phase.request.target === target ? phase.request : null,
    locked: phase.kind !== "idle",
    /** 적용하지 않은 폼 때문에 막은 마지막 동작. */
    formBlocked: form?.blocked ?? null,
    blocks: (request: SaveRequest) => flow.blocks(request),
    request: (request: SaveRequest, submit: () => Promise<SaveState>, onUnchanged?: () => void) =>
      flow.request(request, submit, onUnchanged),
  };
}

/** 넣기·수정 폼의 열기·닫기와, 열린 폼 때문에 막을 동작. 화면에 폼은 하나만 열린다. */
export function useFormFlow() {
  const flow = useFlow();
  const { phase, form } = useFlowState(flow);
  return {
    form,
    /** 저장 중이거나 다른 폼이 열려 있으면 새 폼을 열 수 없다. */
    canOpen: phase.kind === "idle" && form === null,
    // 화면이 effect 정리에 쓸 수 있게 흐름의 메서드를 그대로 넘겨 렌더마다 같은 함수가 되게 한다.
    open: flow.openForm,
    edit: flow.editForm,
    close: flow.closeForm,
    blocks: flow.blockedByForm,
  };
}

/** 적용하지 않은 폼 때문에 막은 동작 옆에 보이는 안내. */
export function FormBlockedNotice() {
  return <p className="text-sm text-amber-600">열려 있는 폼을 먼저 적용하거나 취소해 주세요.</p>;
}

/** 바뀐 영역이 있으면 색만이 아니라 문구와 영역 이름으로 알린다. */
export function UnsavedNotice() {
  const areas = unsavedAreas(useFlowState(useFlow()).changed);
  if (areas.length === 0) return null;
  return <p className="text-sm text-amber-600">저장하지 않은 변경이 있어요. 바뀐 곳: {areas.join(", ")}</p>;
}
