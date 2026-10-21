// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { Collection } from "@/lib/editor-config";
import { metadataText, type MdxDoc } from "@/lib/mdx-doc";
import {
  readStatus,
  readTrash,
  statusSupport,
  type MetadataObject,
  type PostAction,
  type PostStatus,
  type StatusProblem,
} from "@/lib/metadata-form";

import type { EditorMode } from "./read";
import type { EditArea } from "./unsaved";

/** 저장하는 단위. 글 화면은 글 하나를 한 번에 저장하고, 새 글 만들기도 저장 하나로 본다. */
export type SaveTarget = "post" | "new";

/**
 * 저장 결과를 화면에 보일 상태. `saved`면 `href`(저장한 글 화면)로 간다.
 * 실패의 `message`는 기본 화면에 보일 이유와 다음 행동이고, `detail`은 기술 상세에 덧붙일 오류 원문이다.
 */
export type SaveState =
  | { status: "idle" }
  | { status: "saved"; href: string }
  | { status: "unchanged" }
  | { status: "error"; message: string; detail?: string; fields?: { [key: string]: string } };

/** 본문 필드 오류의 키. 설정 폼의 키와 겹치지 않는다. */
export const BODY_FIELD = "body";

/** 편집 모드마다 저장할 때 함께 담는 영역. 제목 입력은 글 설정 폼이라 `metadata`에 든다. */
const MODE_AREAS: { [mode in EditorMode]: EditArea[] } = {
  wysiwyg: ["metadata", "body", "images"],
  source: ["source", "sourceImages"],
};

/** 저장 대상의 화면이 두는 편집 영역. 글 화면은 두 모드의 편집기를 모두 띄워 둔다. */
const SCREEN_AREAS: { [target in SaveTarget]: EditArea[] } = {
  post: [...MODE_AREAS.wysiwyg, ...MODE_AREAS.source],
  new: ["title", "submenu"],
};

/** 글 화면이 metadata 폼과 WYSIWYG 본문을 다시 열지 정하는 key. 원문은 파일 전체라 저장마다 다시 연다. */
export type EditorKeys = { metadata: string; body: string };

/** 원문과 그 doc으로 만든 `EditorKeys`. 구간으로 나눌 수 없는 글은 원문이 바뀌면 둘 다 다시 연다. */
export function docEditorKeys(source: string, doc: MdxDoc): EditorKeys {
  if (!doc.ok) return { metadata: source, body: source };
  return { metadata: metadataText(doc) ?? "", body: doc.body };
}

/**
 * 저장 하나. 글 저장은 행동과, 그 행동이 담을 입력을 정하는 편집 모드를 함께 받는다.
 * 게시 내리기는 상태만 바꾸므로 입력을 담지 않는다. 화면이 먼저 반영하거나 버리게 한다.
 */
export type SaveRequest =
  | { target: "post"; action: Exclude<PostAction, "unpublish">; mode: EditorMode }
  | { target: "post"; action: "unpublish" }
  | { target: "new" };

/**
 * 저장 요청이 함께 커밋하는 편집 영역. 일반 편집은 제목·설정·본문·첨부를, 원문 편집은 원문과 그 첨부를 한 번에 담는다.
 * 영역마다 따로 저장하지 않으므로 한 저장이 같은 모드의 다른 영역 입력을 남겨 두고 버리는 일이 없다.
 */
export function savedAreas(request: SaveRequest): EditArea[] {
  if (request.target === "new") return SCREEN_AREAS.new;
  if (request.action === "unpublish") return [];
  return MODE_AREAS[request.mode];
}

/**
 * 저장할 때 편집 영역이 내는 입력. `text`는 본문이나 원문, `data`는 설정 폼 값과 첨부 이미지다.
 * `unchanged`는 서버가 변경 없음으로 답했을 때 낸 입력을 그 영역의 저장 기준으로 삼게 한다.
 */
export type PostInput = { text: string; data: FormData; unchanged: () => void };

/** 저장할 때 입력을 내는 영역. 낼 수 없으면 null을 돌려주고 이유는 그 영역 옆에 보인다. */
export type PostInputCollectors = {
  /** 제목을 포함한 글 설정 폼. 일반 편집에서만 함께 저장한다. */
  settings?: () => Omit<PostInput, "text"> | null;
  wysiwyg?: () => PostInput | null;
  source?: () => PostInput | null;
};

/**
 * 지금 모드로 저장할 글 전체 입력을 모은다. 일반 편집은 설정 폼과 본문·첨부를, 원문 편집은 원문과 첨부를 한 요청에 담는다.
 * 어느 영역이든 낼 수 없으면 null.
 */
export function collectPostInput(collectors: PostInputCollectors, mode: EditorMode): PostInput | null {
  if (mode === "source") return collectors.source?.() ?? null;
  // 설정 폼을 먼저 검사해, 빠진 필수 값이 있으면 본문보다 먼저 그 칸을 알린다.
  const settings = collectors.settings?.();
  if (settings === null) return null;
  const editor = collectors.wysiwyg?.() ?? null;
  if (!editor || !settings) return editor;
  const data = new FormData();
  for (const [name, value] of [...settings.data, ...editor.data]) data.append(name, value);
  return {
    text: editor.text,
    data,
    unchanged: () => {
      settings.unchanged();
      editor.unchanged();
    },
  };
}

/** 상태 문제로 저장할 수 없을 때 기본 화면에 보일 이유와 할 일. 설정이나 원문을 확인하게 한다. */
export const STATUS_PROBLEM_MESSAGES: { [problem in StatusProblem]: string } = {
  "status-field":
    "이 글 분류는 편집 설정에 초안·게시 상태가 없어 저장할 수 없어요. 레포 관리자에게 편집 설정을 확인해 달라고 해 주세요.",
  "status-options":
    "이 글 분류는 편집 설정에 초안·게시 상태가 없어 저장할 수 없어요. 레포 관리자에게 편집 설정을 확인해 달라고 해 주세요.",
  "status-value":
    "글의 게시 상태를 알 수 없어 저장할 수 없어요. 레포에서 이 글 원문의 상태 값이 draft나 ready인지 확인해 주세요.",
  action: "글의 지금 상태에서는 할 수 없는 저장이에요. 글을 다시 열어 주세요.",
};

/** 휴지통 글은 복구한 뒤에 고친다. */
export const TRASHED_MESSAGE = "휴지통에 있는 글이에요. 복구한 뒤에 고칠 수 있어요.";

/**
 * 글 화면에 보일 글 상태와 저장 행동. 한 상태에서 주 행동은 하나다.
 * 행동이 없으면 `status`는 보일 상태(휴지통)나 null이고, `notice`는 행동이 없는 이유와 할 일이다.
 */
export type PostActions =
  | { ok: true; status: PostStatus; primary: PostAction; secondary: PostAction[] }
  | { ok: false; status: "trashed" | null; notice: string };

const STATUS_ACTIONS: { [status in PostStatus]: { primary: PostAction; secondary: PostAction[] } } = {
  draft: { primary: "publish", secondary: ["save-draft"] },
  ready: { primary: "update", secondary: ["unpublish"] },
};

/**
 * 글의 상태로 보일 저장 행동을 정한다. 휴지통 표시는 게시 상태보다 먼저 본다.
 * 상태를 다룰 수 없는 글(설정에 상태가 없거나 글의 상태를 읽을 수 없음)은 다른 상태로 넘겨짚지 않고 행동을 두지 않는다.
 * @param metadata 폼으로 읽은 글 설정. 읽을 수 없으면 null.
 */
export function postActions(collection: Collection, metadata: MetadataObject | null): PostActions {
  if (metadata && readTrash(metadata).trashed) return { ok: false, status: "trashed", notice: TRASHED_MESSAGE };
  const support = statusSupport(collection);
  if (!support.ok) return { ok: false, status: null, notice: STATUS_PROBLEM_MESSAGES[support.reason] };
  const status = metadata && readStatus(metadata);
  if (!status) return { ok: false, status: null, notice: STATUS_PROBLEM_MESSAGES["status-value"] };
  return { ok: true, status, ...STATUS_ACTIONS[status] };
}

export type SavePhase =
  | { kind: "idle" }
  | { kind: "saving"; request: SaveRequest }
  /**
   * 저장해 `href`(저장한 글 화면)로 가는 중. `settled`는 저장했거나 버리기로 한 영역이라 이 이동에 이탈을 확인하지 않는다.
   * 화면이 열려 `settle`하기 전까지는 입력을 막아, 다시 열릴 영역에 새로 입력하고 잃지 않게 한다.
   */
  | { kind: "saved"; request: SaveRequest; href: string; settled: EditArea[] };

/** 넣기·수정 폼을 여는 편집 영역. 폼을 적용하면 이 영역의 미저장 변경이 된다. */
export type FormArea = Extract<EditArea, "body" | "source">;

/** 폼이 열려 있어 막은 동작. 글 저장 행동, 새 글 만들기, 모드 전환, 이미지 받기. */
export type FormBlocked = PostAction | "new" | "mode" | "image";

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
  /** 이미지를 준비하는 편집 영역. 준비가 끝나면 그 영역에 폼이 열리므로 그동안 저장과 모드 전환을 막는다. */
  preparing: { [area in FormArea]?: boolean };
};

export type SaveFlow = {
  getState(): SaveFlowState;
  subscribe(listener: () => void): () => void;
  report(area: EditArea, changed: boolean): void;
  /** 편집 영역이 이미지를 준비하는 중인지 알린다. */
  prepare(area: FormArea, preparing: boolean): void;
  /**
   * 지금 `request`를 시작할 수 없는지. 다른 저장이 진행 중이거나, 적용하지 않은 폼이 있거나, 이미지를 준비하는 중이다.
   * 폼 때문이면 막은 행동을 기록한다. 화면이 저장할 입력을 모으기 전에 묻는다.
   */
  blocks(request: SaveRequest): boolean;
  /**
   * 저장을 시작한다. `blocks`이면 하지 않고 false.
   * @param onUnchanged 서버가 변경 없음으로 답하면 부른다. 제출한 입력을 저장 기준으로 삼게 한다.
   */
  request(request: SaveRequest, submit: () => Promise<SaveState>, onUnchanged?: () => void): boolean;
  /**
   * 폼을 연다. 저장 중이거나 다른 폼이 열려 있으면 열지 않고 false.
   * 폼이 열려 있는 동안은 모든 저장 요청을 막는다. 폼을 열고 닫는 것만으로는 영역의 미저장 변경을 바꾸지 않는다.
   */
  openForm(area: FormArea): boolean;
  /** 폼 안의 작성 중 입력이 처음 값과 다른지 알린다. 다르면 이탈 확인에 그 영역이 든다. */
  editForm(dirty: boolean): void;
  /** 적용·취소로 폼을 닫는다. 적용한 결과는 그 영역의 편집기가 미저장 변경으로 알린다. */
  closeForm(): void;
  /** 폼이 열려 있으면 `action`을 막았다고 기록하고 true. 모드 전환·이미지 받기처럼 저장 밖의 동작이 막을지 물을 때 쓴다. */
  blockedByForm(action: FormBlocked): boolean;
  /**
   * 저장한 글 화면이 열렸다. 그 저장의 결과를 지우고 입력을 다시 받는다. 미저장 표시는 편집 영역이 알린 그대로 둔다.
   * @returns 끝낸 저장 요청. 저장해 가는 중이 아니었으면 null.
   */
  settle(): SaveRequest | null;
};

type Job = { request: SaveRequest; submit: () => Promise<SaveState>; onUnchanged?: () => void };

const FAILED: SaveState = { status: "error", message: "저장하지 못했어요. 연결을 확인한 뒤 다시 저장해 주세요." };

/**
 * 저장에 성공해 저장한 글 화면으로 갈 때 잃어도 되는 영역. 저장한 영역이고, 게시 내리기는 확인에서 버리기로 한 글 화면 전체다.
 */
const settledAreas = (request: SaveRequest): EditArea[] =>
  request.target === "post" && request.action === "unpublish" ? SCREEN_AREAS.post : savedAreas(request);

/** 폼 때문에 막았다고 기록할 동작. */
const blockedAction = (request: SaveRequest): FormBlocked => (request.target === "post" ? request.action : "new");

/** 한 화면의 저장들을 하나씩만 진행하게 묶는다. @param navigate 저장에 성공하면 저장한 글 화면으로 간다. */
export function createSaveFlow({ navigate }: { navigate: (href: string) => void }): SaveFlow {
  let state: SaveFlowState = { phase: { kind: "idle" }, changed: {}, results: {}, form: null, preparing: {} };
  const listeners = new Set<() => void>();

  const update = (next: Partial<SaveFlowState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const run = async ({ request, submit, onUnchanged }: Job) => {
    update({ phase: { kind: "saving", request } });
    let result: SaveState;
    try {
      result = await submit();
    } catch {
      result = FAILED;
    }
    if (result.status === "unchanged") onUnchanged?.();
    update({
      results: { ...state.results, [request.target]: result },
      phase:
        result.status === "saved"
          ? { kind: "saved", request, href: result.href, settled: settledAreas(request) }
          : { kind: "idle" },
    });
    if (result.status === "saved") navigate(result.href);
  };

  const blockedByForm = (action: FormBlocked) => {
    if (!state.form) return false;
    if (state.form.blocked !== action) update({ form: { ...state.form, blocked: action } });
    return true;
  };

  const blocks = (request: SaveRequest) =>
    state.phase.kind !== "idle" ||
    blockedByForm(blockedAction(request)) ||
    Object.values(state.preparing).some(Boolean);

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
    prepare(area, preparing) {
      if (Boolean(state.preparing[area]) === preparing) return;
      update({ preparing: { ...state.preparing, [area]: preparing } });
    },
    blocks,
    request(request, submit, onUnchanged) {
      if (blocks(request)) return false;
      void run({ request, submit, onUnchanged });
      return true;
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
    settle() {
      if (state.phase.kind !== "saved") return null;
      const { request } = state.phase;
      const results = { ...state.results };
      delete results[request.target];
      update({ phase: { kind: "idle" }, results });
      return request;
    },
  };
}
