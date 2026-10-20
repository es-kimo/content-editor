// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { SaveFlowState } from "./save-flow";
import type { EditArea } from "./unsaved";

/** 화면을 떠나면 사라지는 미저장 영역. 저장해 저장한 글 화면으로 가는 중이면 저장했거나 버리기로 한 영역은 뺀다. */
export function leavingAreas({ phase, changed }: Pick<SaveFlowState, "phase" | "changed">): EditArea[] {
  const kept = phase.kind === "saved" ? phase.reopened : [];
  return (Object.keys(changed) as EditArea[]).filter((area) => changed[area] && !kept.includes(area));
}

/** 앱이 확인을 띄울 수 있는 이동. `push`는 같은 탭의 앱 안 링크, `traverse`는 브라우저 뒤로·앞으로. */
export type Leave = { kind: "push"; href: string } | { kind: "traverse"; key: string };

/**
 * 브라우저 뒤로·앞으로를 앱이 확인할지. 막을 수 없는 이동(다른 문서로 가는 이력 이동 등)은 브라우저 기본 경고에 맡겨
 * 한 번의 이동에 두 확인이 뜨지 않게 한다. 해시만 다른 이력은 같은 화면이라 입력을 잃지 않는다.
 */
export function traverseNeedsConfirm({
  from,
  to,
  cancelable,
}: {
  from: string;
  to: string;
  cancelable: boolean;
}): boolean {
  if (!cancelable) return false;
  const withoutHash = (href: string) => href.split("#")[0];
  return withoutHash(from) !== withoutHash(to);
}

export type LeaveGuardState = {
  /** 확인 중인 이동. */
  pending: Leave | null;
  /** 사라질 영역. 확인 중일 때만 채운다. */
  areas: EditArea[];
};

export type LeaveGuard = {
  getState(): LeaveGuardState;
  subscribe(listener: () => void): () => void;
  /**
   * 앱이 막을 수 있는 이동을 요청한다. 그대로 이동해도 되면 true.
   * 사라질 입력이 있으면 false를 돌려주고 확인을 띄운다. 호출자는 이동을 막는다.
   */
  request(leave: Leave): boolean;
  /** `계속 편집`. 이동하지 않는다. */
  stay(): void;
  /** `변경 버리고 나가기`. 요청한 목적지로 한 번 간다. 도착할 때까지 다른 확인과 브라우저 기본 경고를 하지 않는다. */
  leave(): void;
  /** 새로고침·탭 닫기·외부 이동에 브라우저 기본 경고를 요청할지. */
  warnsUnload(): boolean;
  /** `변경 버리고 나가기`를 골라 도착을 기다리는 중인지. 떠난 화면이 숨겨질 때 입력을 버릴지 정한다. */
  discarding(): boolean;
  /** 화면 주소가 바뀌었다. 나가기로 한 이동이 끝났으니 다시 지킨다. */
  arrived(): void;
};

/**
 * 한 화면의 이탈 확인을 묶는다. 확인 자체는 아무것도 저장하지 않는다.
 * @param areas 지금 떠나면 사라지는 미저장 영역.
 * @param go 나가기로 한 이동을 실제로 한다.
 */
export function createLeaveGuard({ areas, go }: { areas: () => EditArea[]; go: (leave: Leave) => void }): LeaveGuard {
  let state: LeaveGuardState = { pending: null, areas: [] };
  let leaving = false;
  const listeners = new Set<() => void>();

  const update = (next: LeaveGuardState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request(leave) {
      if (leaving) return true;
      if (state.pending) return false;
      const lost = areas();
      if (lost.length === 0) return true;
      update({ pending: leave, areas: lost });
      return false;
    },
    stay() {
      if (!state.pending) return;
      update({ pending: null, areas: [] });
    },
    leave() {
      const leave = state.pending;
      if (!leave) return;
      leaving = true;
      update({ pending: null, areas: [] });
      go(leave);
    },
    warnsUnload: () => !leaving && areas().length > 0,
    discarding: () => leaving,
    arrived() {
      leaving = false;
    },
  };
}
