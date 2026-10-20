"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { ConfirmDialog } from "@/app/_lib/confirm-dialog";
import { LeaveGuardProvider } from "@/app/_lib/leave";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 미저장 판정과 저장 흐름만 가져온다.
import { leavingAreas } from "@/lib/content/leave-guard";
import {
  createSaveFlow,
  type SaveFlow,
  type SaveRequest,
  type SaveState,
  type SaveTarget,
} from "@/lib/content/save-flow";
import { areaNames, unsavedAreas, type EditArea } from "@/lib/content/unsaved";

const SaveFlowContext = createContext<SaveFlow | null>(null);

/**
 * 화면의 편집 영역들이 알린 미저장 변경과 저장을 모으고, 미저장 입력을 잃는 이동 전에 묻는다.
 * 숨긴 편집기도 띄워 둔 채라 계속 알린다.
 * @param revision 저장한 글 화면이 열릴 때마다 바뀌는 값(`saved` 커밋). 바뀌면 저장 뒤 막아 둔 입력을 다시 받는다.
 */
export function UnsavedProvider({ revision, children }: { revision?: string; children: ReactNode }) {
  const router = useRouter();
  const [flow] = useState(() => createSaveFlow({ navigate: (href) => router.push(href) }));
  useEffect(() => flow.settle(), [flow, revision]);
  return (
    <SaveFlowContext value={flow}>
      <LeaveGuardProvider areas={() => leavingAreas(flow.getState())}>
        {children}
        <DiscardDialog flow={flow} />
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

/** 저장이 진행 중이거나 확인 중이면 true. 그동안 입력·첨부·모드 전환·다른 저장을 막는다. */
export function useSaveLocked(): boolean {
  return useFlowState(useFlow()).phase.kind !== "idle";
}

const IDLE: SaveState = { status: "idle" };

/** 저장 대상 하나의 저장 버튼 상태와 제출. 제출은 `SaveFlow.request`를 따른다. */
export function useSave(target: SaveTarget) {
  const flow = useFlow();
  const { phase, results } = useFlowState(flow);
  return {
    state: results[target] ?? IDLE,
    // 성공한 뒤 저장한 글 화면이 열릴 때까지도 저장 중으로 보인다.
    pending: (phase.kind === "saving" || phase.kind === "saved") && phase.target === target,
    locked: phase.kind !== "idle",
    request: (request: SaveRequest, submit: () => Promise<SaveState>, onUnchanged?: () => void) =>
      flow.request(request, submit, onUnchanged),
  };
}

/** 바뀐 영역이 있으면 색만이 아니라 문구와 영역 이름으로 알린다. */
export function UnsavedNotice() {
  const areas = unsavedAreas(useFlowState(useFlow()).changed);
  if (areas.length === 0) return null;
  return <p className="text-sm text-amber-600">저장하지 않은 변경이 있다. 바뀐 영역: {areas.join(", ")}</p>;
}

/** 저장으로 다른 영역의 미저장 입력이 사라질 때 묻는다. */
function DiscardDialog({ flow }: { flow: SaveFlow }) {
  const { phase } = useFlowState(flow);
  return (
    <ConfirmDialog
      open={phase.kind === "confirming"}
      title="다른 영역의 저장하지 않은 입력이 사라진다"
      confirmLabel="다른 변경 버리고 저장"
      onKeep={() => flow.cancel()}
      onConfirm={() => flow.confirm()}
    >
      <p className="text-sm">
        저장하면 저장한 파일로 다시 열려 입력이 사라지는 영역:{" "}
        {phase.kind === "confirming" && areaNames(phase.discarded).join(", ")}
      </p>
      <p className="text-xs text-zinc-500">저장이 실패하면 모든 입력이 그대로 남는다.</p>
    </ConfirmDialog>
  );
}
