// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import { metadataText, parseMdx, type MdxDoc, type Syntax } from "@/lib/mdx-doc";

import type { EditArea } from "./unsaved";

/** 따로 저장하는 단위. 새 글 만들기도 저장 하나로 본다. */
export type SaveTarget = "metadata" | "body" | "source" | "new";

/**
 * 저장 결과를 화면에 보일 상태. `saved`면 `href`(저장한 글 화면)로 간다.
 * 실패의 `message`는 기본 화면에 보일 이유와 다음 행동이고, `detail`은 기술 상세에 덧붙일 오류 원문이다.
 */
export type SaveState =
  | { status: "idle" }
  | { status: "saved"; href: string }
  | { status: "unchanged" }
  | { status: "error"; message: string; detail?: string; fields?: { [key: string]: string } };

/** 저장하면 커밋되는 편집 영역. */
const SAVED_AREAS: { [target in SaveTarget]: EditArea[] } = {
  metadata: ["metadata"],
  body: ["body", "images"],
  source: ["source"],
  new: ["title", "submenu"],
};

/** 글 화면이 metadata 폼과 WYSIWYG 본문을 다시 열지 정하는 key. 원문은 파일 전체라 저장마다 다시 연다. */
export type EditorKeys = { metadata: string; body: string };

/** 원문과 그 doc으로 만든 `EditorKeys`. 구간으로 나눌 수 없는 글은 원문이 바뀌면 둘 다 다시 연다. */
export function docEditorKeys(source: string, doc: MdxDoc): EditorKeys {
  if (!doc.ok) return { metadata: source, body: source };
  return { metadata: metadataText(doc) ?? "", body: doc.body };
}

/** 저장 하나. 원문 저장은 어느 영역이 다시 열릴지 고친 원문으로 정하므로 연 원문과 고친 원문을 함께 받는다. */
export type SaveRequest =
  { target: "metadata" | "body" | "new" } | { target: "source"; before: string; after: string; syntax: Syntax };

/** 저장이 성공해 저장한 글 화면이 열리면 다시 열려 입력이 처음 값으로 돌아가는 영역. 저장한 영역도 포함한다. */
export function reopenedAreas(request: SaveRequest): EditArea[] {
  switch (request.target) {
    case "metadata":
      return ["metadata", "source"];
    case "body":
      return ["body", "images", "source"];
    case "new":
      return SAVED_AREAS.new;
    case "source": {
      const before = docEditorKeys(request.before, parseMdx(request.before, request.syntax));
      const after = docEditorKeys(request.after, parseMdx(request.after, request.syntax));
      return [
        ...(before.metadata !== after.metadata ? (["metadata"] as const) : []),
        ...(before.body !== after.body ? (["body", "images"] as const) : []),
        "source",
      ];
    }
  }
}

/** 저장하면 커밋되지 않은 채 사라지는 다른 영역의 미저장 입력. 비어 있으면 확인 없이 저장한다. */
export function discardedAreas(request: SaveRequest, changed: { [area in EditArea]?: boolean }): EditArea[] {
  const saved = SAVED_AREAS[request.target];
  return reopenedAreas(request).filter((area) => changed[area] && !saved.includes(area));
}

export type SavePhase =
  | { kind: "idle" }
  /** 다른 영역 입력이 사라지는 저장이라 버릴지 묻는 중. */
  | { kind: "confirming"; target: SaveTarget; discarded: EditArea[] }
  | { kind: "saving"; target: SaveTarget }
  /**
   * 저장해 `href`(저장한 글 화면)로 가는 중. 이 이동으로 사라지는 입력은 저장했거나 버리기로 한 것이라 이탈을 확인하지 않는다.
   * 화면이 열려 `settle`하기 전까지는 입력을 막아, 다시 열릴 영역에 새로 입력하고 잃지 않게 한다.
   */
  | { kind: "saved"; target: SaveTarget; href: string; reopened: EditArea[] };

/** 넣기·수정 폼을 여는 편집 영역. 폼을 적용하면 이 영역의 미저장 변경이 된다. */
export type FormArea = Extract<EditArea, "body" | "source">;

/** 폼이 열려 있어 막은 동작. 저장 대상 또는 모드 전환. */
export type FormBlocked = SaveTarget | "mode";

/**
 * 적용하지 않은 넣기·수정 폼.
 * `dirty`는 폼 안의 작성 중 입력이 처음 값과 다른지, `blocked`는 폼 때문에 막은 마지막 동작이다.
 */
export type OpenForm = { area: FormArea; dirty: boolean; blocked: FormBlocked | null };

export type SaveFlowState = {
  phase: SavePhase;
  /** 영역별 미저장 변경. 편집 영역이 알린다. 저장 결과로 바꾸지 않는다. */
  changed: { [area in EditArea]?: boolean };
  /** 저장 대상별 마지막 결과. */
  results: { [target in SaveTarget]?: SaveState };
  /** 열려 있는 폼. 화면에 하나만 연다. */
  form: OpenForm | null;
};

export type SaveFlow = {
  getState(): SaveFlowState;
  subscribe(listener: () => void): () => void;
  report(area: EditArea, changed: boolean): void;
  /**
   * 저장을 시작한다. 다른 저장이 진행 중이거나 확인 중이면 하지 않고 false.
   * 다른 영역 입력이 사라지면 먼저 `confirming`으로 두고, `confirm`해야 `submit`을 부른다.
   * @param onUnchanged 서버가 변경 없음으로 답하면 부른다. 제출한 영역만 지금 입력을 저장 기준으로 삼게 한다.
   */
  request(request: SaveRequest, submit: () => Promise<SaveState>, onUnchanged?: () => void): boolean;
  /**
   * 폼을 연다. 저장 중이거나 확인 중이거나 다른 폼이 열려 있으면 열지 않고 false.
   * 폼이 열려 있는 동안은 모든 저장 요청을 막는다. 폼을 열고 닫는 것만으로는 영역의 미저장 변경을 바꾸지 않는다.
   */
  openForm(area: FormArea): boolean;
  /** 폼 안의 작성 중 입력이 처음 값과 다른지 알린다. 다르면 이탈 확인에 그 영역이 든다. */
  editForm(dirty: boolean): void;
  /** 적용·취소로 폼을 닫는다. 적용한 결과는 그 영역의 편집기가 미저장 변경으로 알린다. */
  closeForm(): void;
  /** 폼이 열려 있으면 `action`을 막았다고 기록하고 true. 모드 전환처럼 저장 밖의 동작이 막을지 물을 때 쓴다. */
  blockedByForm(action: FormBlocked): boolean;
  /** `다른 변경 버리고 저장`. 버리는 것은 저장이 성공해 화면이 다시 열릴 때뿐이다. */
  confirm(): void;
  /** `계속 편집`. 제출하지 않는다. */
  cancel(): void;
  /** 저장한 글 화면이 열렸다. 다시 열린 영역의 결과를 지우고 입력을 다시 받는다. */
  settle(): void;
};

type Job = { target: SaveTarget; reopened: EditArea[]; submit: () => Promise<SaveState>; onUnchanged?: () => void };

const FAILED: SaveState = { status: "error", message: "저장하지 못했어요. 연결을 확인한 뒤 다시 저장해 주세요." };

/** 한 화면의 저장들을 하나씩만 진행하게 묶는다. @param navigate 저장에 성공하면 저장한 글 화면으로 간다. */
export function createSaveFlow({ navigate }: { navigate: (href: string) => void }): SaveFlow {
  let state: SaveFlowState = { phase: { kind: "idle" }, changed: {}, results: {}, form: null };
  let waiting: Job | null = null;
  const listeners = new Set<() => void>();

  const update = (next: Partial<SaveFlowState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const run = async (job: Job) => {
    update({ phase: { kind: "saving", target: job.target } });
    let result: SaveState;
    try {
      result = await job.submit();
    } catch {
      result = FAILED;
    }
    if (result.status === "unchanged") job.onUnchanged?.();
    update({
      results: { ...state.results, [job.target]: result },
      phase:
        result.status === "saved"
          ? { kind: "saved", target: job.target, href: result.href, reopened: job.reopened }
          : { kind: "idle" },
    });
    if (result.status === "saved") navigate(result.href);
  };

  const blockedByForm = (action: FormBlocked) => {
    if (!state.form) return false;
    if (state.form.blocked !== action) update({ form: { ...state.form, blocked: action } });
    return true;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    report(area, changed) {
      if (Boolean(state.changed[area]) === changed) return;
      update({ changed: { ...state.changed, [area]: changed } });
    },
    request(request, submit, onUnchanged) {
      if (state.phase.kind !== "idle" || blockedByForm(request.target)) return false;
      const job = { target: request.target, reopened: reopenedAreas(request), submit, onUnchanged };
      const discarded = discardedAreas(request, state.changed);
      if (discarded.length === 0) {
        void run(job);
        return true;
      }
      waiting = job;
      update({ phase: { kind: "confirming", target: request.target, discarded } });
      return true;
    },
    confirm() {
      if (state.phase.kind !== "confirming" || !waiting) return;
      const job = waiting;
      waiting = null;
      void run(job);
    },
    openForm(area) {
      if (state.phase.kind !== "idle" || state.form) return false;
      update({ form: { area, dirty: false, blocked: null } });
      return true;
    },
    editForm(dirty) {
      if (!state.form || state.form.dirty === dirty) return;
      update({ form: { ...state.form, dirty } });
    },
    closeForm() {
      if (state.form) update({ form: null });
    },
    blockedByForm,
    cancel() {
      if (state.phase.kind !== "confirming") return;
      waiting = null;
      update({ phase: { kind: "idle" } });
    },
    settle() {
      if (state.phase.kind !== "saved") return;
      const { reopened } = state.phase;
      const results = Object.fromEntries(
        Object.entries(state.results).filter(
          ([target]) => !SAVED_AREAS[target as SaveTarget].some((area) => reopened.includes(area)),
        ),
      );
      update({ phase: { kind: "idle" }, results });
    },
  };
}
