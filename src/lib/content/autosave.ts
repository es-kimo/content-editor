// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import {
  clearSavedDraft,
  discardDraft,
  saveDraft,
  type DraftContent,
  type DraftKey,
  type DraftStorage,
  type SaveDraftResult,
} from "./draft";
import type { SaveState } from "./save-flow";
import { koreaTimeText } from "./summary";

/** 마지막 입력 뒤 보관할 때까지 기다리는 시간. 저장소에 쓰는 시간을 더해도 PRD의 ‘2초 안에’를 넘지 않게 둔다. */
export const AUTOSAVE_DELAY_MS = 1000;

/** `run`을 `ms` 뒤에 부르게 하고, 그 예약을 취소하는 함수를 돌려준다. 테스트가 주입한다. */
export type Schedule = (run: () => void, ms: number) => () => void;

/** 이 탭의 마지막 자동 보관 결과. `missing`은 텍스트만 보관하느라 빠진 첨부 파일 이름이다. */
export type AutosaveState =
  { kind: "idle" } | { kind: "saved"; savedAt: number; missing: string[] } | { kind: "failed" };

export type Autosave = {
  getState(): AutosaveState;
  subscribe(listener: () => void): () => void;
  /** 입력이 바뀌었다. 입력이 멈추고 `AUTOSAVE_DELAY_MS`가 지나면 그때의 입력을 한 번 보관한다. */
  touch(): void;
  /** 기다리던 보관을 바로 한다. 화면이 숨겨지거나 닫힐 때 부른다. */
  flush(): Promise<void>;
  /**
   * 글 저장을 감싼다. 아직 보관하지 않은 입력이 있으면 저장할 `content`를 먼저 보관하고,
   * 저장에 성공하면 저장한 내용과 같은 이 탭의 보관본만 지운다(`clearSavedDraft`).
   * @param content 저장 버튼을 누를 때 모은 입력. 저장하는 동안 입력이 막혀 바뀌지 않는다.
   */
  saving(content: DraftContent | null, submit: () => Promise<SaveState>): Promise<SaveState>;
  /** ‘버리고 나가기’·‘작성 취소’. 기다리던 보관을 취소하고 이 탭의 보관본을 지운다. 그 뒤로는 보관하지 않는다. */
  discard(): Promise<void>;
  /** 복구한 보관본의 키로 이어서 보관한다. 복구한 입력과 이어 쓴 입력이 보관본 둘로 나뉘지 않는다. */
  adopt(key: DraftKey): void;
};

/**
 * 한 편집 화면의 브라우저 자동 보관. 저장소 쓰기는 하나씩 차례로 해 늦게 끝난 보관이 나중 입력을 덮지 않는다.
 * @param collect 보관할 지금 입력(`collectDraft`). 편집기가 아직 없으면 null이고 보관하지 않는다.
 * @param base 편집을 연 글의 blob sha. 저장해 글이 바뀌면 새 sha를 돌려준다. 새 글은 null.
 */
export function createAutosave({
  storage,
  key: initialKey,
  base,
  collect,
  schedule,
  now,
  delay = AUTOSAVE_DELAY_MS,
}: {
  storage: DraftStorage;
  key: DraftKey;
  base: () => string | null;
  collect: () => DraftContent | null;
  schedule: Schedule;
  now: () => Date;
  delay?: number;
}): Autosave {
  let state: AutosaveState = { kind: "idle" };
  let key = initialKey;
  let cancel: (() => void) | null = null;
  let discarded = false;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const update = (next: AutosaveState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => {});
    return queue;
  };

  const store = (content: DraftContent | null) =>
    enqueue(async () => {
      if (!content || discarded) return;
      let result: SaveDraftResult;
      try {
        result = await saveDraft(storage, key, content, base(), now());
      } catch {
        result = { ok: false, reason: "storage" };
      }
      if (discarded) return;
      update(result.ok ? { kind: "saved", savedAt: result.savedAt, missing: result.missing } : { kind: "failed" });
    });

  /** 기다리던 보관을 취소한다. 기다리던 것이 있었으면 true. */
  const unschedule = () => {
    if (!cancel) return false;
    cancel();
    cancel = null;
    return true;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    touch() {
      if (discarded) return;
      unschedule();
      cancel = schedule(() => {
        cancel = null;
        void store(collect());
      }, delay);
    },
    flush() {
      return unschedule() ? store(collect()) : queue;
    },
    async saving(content, submit) {
      // 마지막 보관이 실패했으면 저장소에는 그보다 앞선 입력이 남아 있어, 저장할 입력으로 바꿔 둬야 저장 뒤 지워진다.
      if (unschedule() || state.kind === "failed") await store(content);
      else await queue;
      const result = await submit();
      if (result.status === "saved" && content) await enqueue(() => clearSavedDraft(storage, key, content));
      return result;
    },
    discard() {
      discarded = true;
      unschedule();
      return enqueue(() => discardDraft(storage, key));
    },
    adopt(next) {
      key = next;
    },
  };
}

/** 자동 보관 표시. `warning`이면 경고 색으로 보인다. 자동 보관은 레포 저장이 아니라 성공 색을 쓰지 않는다. */
export type AutosaveNotice = { tone: "info" | "warning"; text: string };

/** 자동 보관에 실패했을 때의 안내. */
export const AUTOSAVE_FAILED = "자동 보관하지 못했어요. 저장하기 전에는 이 화면을 닫지 마세요.";

/**
 * 자동 보관 상태 줄의 문구. 아직 보관한 적이 없으면 null.
 * 텍스트만 보관했거나 준비 중인 이미지가 있으면 다 보관했다고 하지 않는다.
 * @param preparing 지금 준비 중인 이미지가 있는지. 준비 중인 이미지는 보관 대상에 들지 않는다.
 */
export function autosaveNotice(state: AutosaveState, preparing: boolean): AutosaveNotice | null {
  if (state.kind === "idle") return null;
  if (state.kind === "failed") return { tone: "warning", text: AUTOSAVE_FAILED };
  const time = koreaTimeText(state.savedAt);
  if (state.missing.length > 0) {
    return {
      tone: "warning",
      text:
        `이 브라우저에 글자만 보관했어요 · ${time}. 이미지 ${state.missing.length}개(${state.missing.join(", ")})는 ` +
        "보관하지 못했어요. 복구한 뒤 이미지를 다시 골라 주세요.",
    };
  }
  if (preparing) {
    return { tone: "info", text: `이 브라우저에 보관했어요 · ${time}. 준비 중인 이미지는 아직 보관하지 않았어요.` };
  }
  return { tone: "info", text: `이 브라우저에 보관했어요 · ${time}` };
}
