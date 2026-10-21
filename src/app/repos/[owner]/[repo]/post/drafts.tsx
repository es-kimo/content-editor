"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { browserDraftStorage } from "@/app/_lib/draft-storage";
import { useLeaveDiscard } from "@/app/_lib/leave";
import { SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";
import { useFormFlow, useImagePreparing, useSaveLocked } from "@/app/_lib/unsaved";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 자동 보관과 보관본만 가져온다.
import { autosaveNotice, createAutosave, type Autosave } from "@/lib/content/autosave";
import {
  collectDraft,
  discardDraft,
  listDrafts,
  removeExpiredDrafts,
  type Draft,
  type DraftContent,
  type DraftInputCollectors,
  type DraftKey,
  type DraftQuery,
} from "@/lib/content/draft";
import { DRAFT_ACTION_LABELS, DRAFT_RESTORE_LIMIT, draftChoices, type DraftChoice } from "@/lib/content/draft-restore";
import type { EditorMode } from "@/lib/content/editor-modes";
import type { Collection } from "@/lib/editor-config";
import type { Syntax } from "@/lib/mdx-doc";

import { usePostEditor } from "./post-editor";

/** 보관본을 나누는 계정·레포·브랜치. 계정은 로그인한 GitHub 사용자다. */
export type DraftOwner = Pick<DraftKey, "login" | "repo" | "branch">;

type DraftsValue = {
  autosave: Autosave;
  owner: DraftOwner;
  query: DraftQuery;
  register: <K extends keyof DraftInputCollectors>(
    kind: K,
    collect: NonNullable<DraftInputCollectors[K]>,
  ) => () => void;
  /** 지금 모드의 보관할 입력. */
  collect: () => DraftContent | null;
};

const DraftsContext = createContext<DraftsValue | null>(null);

/** 탭·새 글 작성 건을 나누는 id. 화면을 열 때마다 새로 만든다. */
const newId = () => crypto.randomUUID();

/**
 * 편집 화면의 입력을 이 브라우저에 자동 보관한다. `PostEditorProvider` 안에 두고, 편집 영역은 `useDraftInput`으로
 * 보관할 입력을 내고 `useDraftTouch`로 입력이 바뀌었다고 알린다. 계정을 모르면 보관하지 않는다.
 * ‘변경 버리고 나가기’·‘작성 취소’로 떠나면 이 탭의 보관본을 지운다.
 * @param query 글 화면은 글 경로, 새 글 화면은 글 분류. 새 글은 화면을 열 때마다 작성 건 id를 새로 만든다.
 * @param base 편집을 연 글의 blob sha. 새 글은 null.
 * @param collection 보관할 설정 폼 값을 읽을 글 분류.
 */
export function DraftsProvider({
  owner,
  ...props
}: {
  owner: DraftOwner | null;
  query: DraftQuery;
  base: string | null;
  collection: Collection;
  children: ReactNode;
}) {
  if (!owner) return props.children;
  return <ActiveDraftsProvider owner={owner} {...props} />;
}

function ActiveDraftsProvider({
  owner,
  query,
  base,
  collection,
  children,
}: {
  owner: DraftOwner;
  query: DraftQuery;
  base: string | null;
  collection: Collection;
  children: ReactNode;
}) {
  const { mode } = usePostEditor();
  const [drafts] = useState(() => createDrafts(owner, query, { mode, base, collection }));
  useEffect(() => drafts.rebase({ mode, base, collection }), [drafts, mode, base, collection]);
  const { autosave } = drafts;
  useLeaveDiscard(useCallback(() => void autosave.discard(), [autosave]));
  // 탭을 닫거나 화면을 떠나면 아직 보관하지 않은 마지막 입력을 바로 보관한다.
  useEffect(() => {
    const flush = () => void autosave.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [autosave]);
  return <DraftsContext value={drafts}>{children}</DraftsContext>;
}

type DraftsBase = { mode: EditorMode; base: string | null; collection: Collection };

/** 한 화면의 자동 보관과 편집 영역이 등록한 보관할 입력. 타이머가 부르는 보관은 마지막으로 그린 모드·기준 sha로 한다. */
function createDrafts(
  owner: DraftOwner,
  query: DraftQuery,
  initial: DraftsBase,
): DraftsValue & {
  rebase(next: DraftsBase): void;
} {
  let latest = initial;
  const collectors: DraftInputCollectors = {};
  const collect = () => collectDraft(collectors, latest.mode, latest.collection);
  const autosave = createAutosave({
    storage: browserDraftStorage,
    key: { ...owner, doc: query.kind === "post" ? query : { ...query, id: newId() }, tab: newId() },
    base: () => latest.base,
    collect,
    schedule: (run, ms) => {
      const timer = window.setTimeout(run, ms);
      return () => window.clearTimeout(timer);
    },
    now: () => new Date(),
  });
  return {
    autosave,
    owner,
    query,
    collect,
    register: (kind, add) => {
      collectors[kind] = add;
      return () => {
        if (collectors[kind] === add) delete collectors[kind];
      };
    },
    rebase(next) {
      latest = next;
    },
  };
}

/** 자동 보관. 계정을 몰라 보관하지 않는 화면이면 null. */
export function useDrafts(): DraftsValue | null {
  return useContext(DraftsContext);
}

/** 편집 영역이 보관할 때 낼 입력을 등록한다. 보관할 때 마지막으로 그린 상태의 입력을 읽는다. */
export function useDraftInput<K extends keyof DraftInputCollectors>(
  kind: K,
  collect: NonNullable<DraftInputCollectors[K]>,
) {
  const drafts = useDrafts();
  useEffect(() => drafts?.register(kind, collect), [drafts, kind, collect]);
}

/** 입력이 바뀌었다고 자동 보관에 알리는 함수. 입력이 멈추면 보관한다. */
export function useDraftTouch(): () => void {
  const drafts = useDrafts();
  return () => drafts?.autosave.touch();
}

/** 자동 보관 상태 줄. 저장 상태와 다른 줄에 두고, 레포 저장이 아니라 성공 색을 쓰지 않는다. */
export function AutosaveNotice() {
  const drafts = useDrafts();
  if (!drafts) return null;
  return <AutosaveLine autosave={drafts.autosave} />;
}

function AutosaveLine({ autosave }: { autosave: Autosave }) {
  const state = useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);
  const notice = autosaveNotice(state, useImagePreparing());
  if (!notice) return null;
  return (
    <p role="status" className={`text-xs ${notice.tone === "warning" ? "text-amber-600" : "text-zinc-500"}`}>
      {notice.text}
    </p>
  );
}

/**
 * 편집 화면을 다시 열었을 때 이 브라우저의 보관본을 보이고 ‘복구’·‘버리기’를 고르게 한다.
 * 복구하면 보관한 모드의 편집기에 다시 열고 그 보관본에 이어서 보관한다. 저장하지는 않는다.
 * @param current 지금 원격 글의 sha. 새 글이면 null.
 * @param remote 비교해 보일 지금 원격 글 원문. 새 글이면 null.
 */
export function DraftRestoreNotice({
  current,
  remote,
  syntax,
  collection,
}: {
  current: string | null;
  remote: string | null;
  syntax: Syntax;
  collection: Collection;
}) {
  const drafts = useDrafts();
  const editor = usePostEditor();
  const locked = useSaveLocked();
  const { form } = useFormFlow();
  const preparing = useImagePreparing();
  if (!drafts) return null;
  return (
    <DraftChoiceList
      owner={drafts.owner}
      query={drafts.query}
      current={current === null ? null : { sha: current, trashed: false }}
      remote={remote}
      post={{ collection, syntax }}
      // 저장 중이거나 폼·이미지 준비가 남은 편집기를 다시 열면 그 입력을 잃는다.
      restoreDisabled={locked || form !== null || preparing}
      onRestore={(draft) => {
        editor.restore(draft);
        drafts.autosave.adopt(draft.key);
      }}
    />
  );
}

/** 휴지통 글 화면의 보관본 안내. 복구하지 않고 지금 글과 보관 내용을 비교해 복사하게 한다. */
export function TrashedDraftNotice({
  owner,
  path,
  sha,
  remote,
  syntax,
  collection,
}: {
  owner: DraftOwner | null;
  path: string;
  sha: string;
  remote: string;
  syntax: Syntax;
  collection: Collection;
}) {
  if (!owner) return null;
  return (
    <DraftChoiceList
      owner={owner}
      query={{ kind: "post", path }}
      current={{ sha, trashed: true }}
      remote={remote}
      post={{ collection, syntax }}
    />
  );
}

function DraftChoiceList({
  owner,
  query,
  current,
  remote,
  post,
  restoreDisabled = false,
  onRestore,
}: {
  owner: DraftOwner;
  query: DraftQuery;
  current: { sha: string; trashed: boolean } | null;
  remote: string | null;
  post: { collection: Collection; syntax: Syntax };
  restoreDisabled?: boolean;
  onRestore?: (draft: Draft) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  // 화면을 연 때의 보관본만 보인다. 숨겼다 다시 보인 화면이 이 탭에서 보관한 입력을 보관본으로 다시 내놓지 않게 한 번만 읽는다.
  const listed = useRef(false);
  useEffect(() => {
    if (listed.current) return;
    listed.current = true;
    const now = new Date();
    removeExpiredDrafts(browserDraftStorage, now)
      .then(() => listDrafts(browserDraftStorage, owner, query, now))
      .then(setDrafts, () => setDrafts([]));
  }, [owner, query]);
  if (!drafts || drafts.length === 0) return null;
  const choices = draftChoices(drafts, current, post);
  const remove = (draft: Draft) => setDrafts((list) => list && list.filter((d) => d !== draft));

  return (
    <section aria-label="이 브라우저에 보관한 입력" className="flex flex-col gap-4">
      {choices.map((choice) => (
        <DraftChoiceItem
          key={JSON.stringify(choice.draft.key)}
          choice={choice}
          remote={remote}
          restoreDisabled={restoreDisabled}
          onRestore={() => {
            onRestore?.(choice.draft);
            // 하나를 복구하면 편집기가 그 입력으로 바뀌므로 다른 보관본은 다음에 다시 열 때 고른다.
            setDrafts([]);
          }}
          onDiscard={() => {
            remove(choice.draft);
            void discardDraft(browserDraftStorage, choice.draft.key).catch(() => {});
          }}
        />
      ))}
      <p className="text-xs text-zinc-500">{DRAFT_RESTORE_LIMIT}</p>
    </section>
  );
}

function DraftChoiceItem({
  choice,
  remote,
  restoreDisabled,
  onRestore,
  onDiscard,
}: {
  choice: DraftChoice;
  remote: string | null;
  restoreDisabled: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const copy = () =>
    navigator.clipboard.writeText(choice.archived).then(
      () => setCopied("done"),
      () => setCopied("failed"),
    );
  const actions = {
    restore: onRestore,
    discard: onDiscard,
    copy: () => void copy(),
  };

  return (
    <div className="flex flex-col gap-2">
      <p className={`text-sm ${choice.kind === "conflict" ? "text-amber-600" : ""}`}>{choice.message}</p>
      <p className="text-xs break-all text-zinc-500">{choice.target}</p>
      {choice.kind === "conflict" && (
        <div className="flex flex-col gap-2">
          {remote !== null && <ReadOnlyText label="지금 글" value={remote} />}
          <ReadOnlyText label="보관한 내용" value={choice.archived} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {choice.actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={action === "restore" && restoreDisabled}
            onClick={actions[action]}
            className={SECONDARY_BUTTON_CLASS}
          >
            {DRAFT_ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      {copied === "done" && <p className="text-xs text-zinc-500">보관한 내용을 복사했어요.</p>}
      {copied === "failed" && (
        <p className="text-xs text-amber-600">복사하지 못했어요. 보관한 내용 칸에서 직접 복사해 주세요.</p>
      )}
    </div>
  );
}

function ReadOnlyText({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <textarea readOnly rows={8} value={value} className="rounded border px-2 py-1 font-mono text-xs" />
    </label>
  );
}
