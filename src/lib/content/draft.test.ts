import { describe, expect, test } from "vitest";

import { parseMdx } from "@/lib/mdx-doc";
import { JPEG, PNG, SOURCE } from "@/test/upload-images";

import {
  checkRestore,
  clearSavedDraft,
  discardDraft,
  draftAttachments,
  listDrafts,
  removeExpiredDrafts,
  saveDraft,
  type Draft,
  type DraftContent,
  type DraftKey,
  type DraftStorage,
} from "./draft";
import { createUploadSession, type PreparedImage } from "./upload-session";

/** 메모리 저장소. `quota`를 넘는 바이트의 첨부를 담으려 하면 브라우저 용량 부족처럼 던진다. */
function memoryStorage({ quota = Infinity } = {}) {
  let blocked = false;
  const items = new Map<string, Draft>();
  const storage: DraftStorage = {
    keys: async () => [...items.keys()],
    get: async (key) => items.get(key),
    set: async (key, draft) => {
      const bytes = draft.attachments.reduce((sum, attachment) => sum + attachment.content.length, 0);
      if (blocked || bytes > quota) throw new DOMException("용량 부족", "QuotaExceededError");
      items.set(key, structuredClone(draft));
    },
    delete: async (key) => {
      items.delete(key);
    },
  };
  /** 이후 쓰기를 모두 막는다. 브라우저가 저장을 차단한 상태다. */
  const block = () => (blocked = true);
  return { storage, items, block };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-20T00:00:00Z");
const after = (ms: number) => new Date(NOW.getTime() + ms);

const OWNER = { login: "alice", repo: "es-kimo/blog", branch: "main" };
const POST = { kind: "post", path: "content/a/index.mdx" } as const;
const key = (overrides: Partial<DraftKey> = {}): DraftKey => ({ ...OWNER, doc: POST, tab: "tab-1", ...overrides });

const content = (body: string, attachments: DraftContent["attachments"] = []): DraftContent => ({
  input: { mode: "form", values: { title: "제목" }, body },
  form: null,
  attachments,
});

describe("보관과 목록", () => {
  test("같은 레포·글이라도 계정이 다르면 이전 계정의 보관본이 목록에 나오지 않는다", async () => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key({ login: "alice" }), content("앨리스 입력"), "sha-1", NOW);

    expect(await listDrafts(storage, { ...OWNER, login: "bob" }, POST, NOW)).toEqual([]);
    expect((await listDrafts(storage, OWNER, POST, NOW)).map((draft) => draft.input)).toEqual([
      content("앨리스 입력").input,
    ]);
  });

  test("레포·브랜치·글 경로가 다른 보관본은 목록에 나오지 않는다", async () => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key({ repo: "es-kimo/other" }), content("다른 레포"), "sha-1", NOW);
    await saveDraft(storage, key({ branch: "dev" }), content("다른 브랜치"), "sha-1", NOW);
    await saveDraft(storage, key({ doc: { kind: "post", path: "content/b/index.mdx" } }), content("다른 글"), "s", NOW);

    expect(await listDrafts(storage, OWNER, POST, NOW)).toEqual([]);
  });

  test("같은 글을 두 탭에서 보관하면 서로 덮어쓰지 않고 최근 보관 순으로 보관 시각과 함께 둘 다 나온다", async () => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key({ tab: "tab-1" }), content("첫 탭"), "sha-1", NOW);
    await saveDraft(storage, key({ tab: "tab-2" }), content("둘째 탭"), "sha-1", after(1000));

    const drafts = await listDrafts(storage, OWNER, POST, after(2000));
    expect(drafts.map((draft) => [draft.key.tab, draft.savedAt, draft.input])).toEqual([
      ["tab-2", after(1000).getTime(), content("둘째 탭").input],
      ["tab-1", NOW.getTime(), content("첫 탭").input],
    ]);
  });

  test("같은 탭에서 다시 보관하면 그 탭의 보관본을 지금 내용과 보관 시각으로 바꾼다", async () => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key(), content("처음"), "sha-1", NOW);
    await saveDraft(storage, key(), content("나중"), "sha-1", after(1000));

    const drafts = await listDrafts(storage, OWNER, POST, after(1000));
    expect(drafts.map((draft) => [draft.savedAt, draft.input])).toEqual([
      [after(1000).getTime(), content("나중").input],
    ]);
  });

  test("새 글은 작성 건마다 따로 보관하고 같은 컬렉션의 새 글 보관본을 모두 찾는다", async () => {
    const { storage } = memoryStorage();
    const newPost = (collection: string, id: string) => key({ doc: { kind: "new", collection, id } });
    await saveDraft(storage, newPost("blog", "a"), content("새 글 a"), null, NOW);
    await saveDraft(storage, newPost("blog", "b"), content("새 글 b"), null, after(1000));
    await saveDraft(storage, newPost("notes", "c"), content("다른 컬렉션"), null, NOW);

    const drafts = await listDrafts(storage, OWNER, { kind: "new", collection: "blog" }, after(1000));
    expect(drafts.map((draft) => [draft.key.doc, draft.baseSha])).toEqual([
      [{ kind: "new", collection: "blog", id: "b" }, null],
      [{ kind: "new", collection: "blog", id: "a" }, null],
    ]);
    expect(await listDrafts(storage, OWNER, POST, after(1000))).toEqual([]);
  });

  test("원문 모드 입력과 적용 전 폼 입력, 기준 sha를 그대로 보관한다", async () => {
    const { storage } = memoryStorage();
    const saved: DraftContent = {
      input: { mode: "source", source: SOURCE },
      form: { area: "source", target: { kind: "footnote", place: null }, input: { text: "각주 작성 중", ids: [] } },
      attachments: [],
    };
    await saveDraft(storage, key(), saved, "sha-1", NOW);

    const [draft] = await listDrafts(storage, OWNER, POST, NOW);
    expect(draft).toMatchObject({ ...saved, baseSha: "sha-1" });
  });
});

describe("정리", () => {
  test("주입한 now 기준으로 30일이 지난 보관본은 목록에서 빠지고 저장소에서 지워진다", async () => {
    const { storage, items } = memoryStorage();
    await saveDraft(storage, key({ tab: "old" }), content("오래된 입력"), "sha-1", NOW);
    await saveDraft(storage, key({ tab: "new" }), content("최근 입력"), "sha-1", after(DAY));

    const drafts = await listDrafts(storage, OWNER, POST, after(30 * DAY + 1));
    expect(drafts.map((draft) => draft.key.tab)).toEqual(["new"]);
    expect(items.size).toBe(1);
  });

  test("마지막 보관 뒤 30일이 되기 전까지는 남긴다", async () => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key(), content("입력"), "sha-1", NOW);
    await saveDraft(storage, key(), content("다시 입력"), "sha-1", after(20 * DAY));

    expect(await listDrafts(storage, OWNER, POST, after(40 * DAY))).toHaveLength(1);
  });

  test("저장소 전체 정리는 다른 계정·글의 만료 보관본도 지우고 기간 안의 보관본은 남긴다", async () => {
    const { storage, items } = memoryStorage();
    await saveDraft(storage, key({ login: "bob" }), content("만료"), "sha-1", NOW);
    await saveDraft(
      storage,
      key({ doc: { kind: "post", path: "content/b/index.mdx" } }),
      content("유지"),
      "s",
      after(DAY),
    );

    await removeExpiredDrafts(storage, after(30 * DAY + 1));
    expect([...items.values()].map((draft) => draft.input)).toEqual([content("유지").input]);
  });

  test("저장 성공 처리는 저장한 내용과 같은 보관본을 지운다", async () => {
    const { storage } = memoryStorage();
    const saved = content("저장할 본문", [{ file: "1.png", content: PNG }]);
    await saveDraft(storage, key(), saved, "sha-1", NOW);

    await clearSavedDraft(storage, key(), content("저장할 본문", [{ file: "1.png", content: PNG.slice() }]));
    expect(await listDrafts(storage, OWNER, POST, NOW)).toEqual([]);
  });

  test("저장하는 동안 더 입력해 보관본이 달라졌으면 저장 성공 처리가 그 뒤 입력을 남긴다", async () => {
    const { storage } = memoryStorage();
    const saved = content("저장할 본문");
    await saveDraft(storage, key(), saved, "sha-1", NOW);
    await saveDraft(storage, key(), content("저장할 본문\n\n저장 중 더 쓴 문단"), "sha-1", after(1000));

    await clearSavedDraft(storage, key(), saved);
    const drafts = await listDrafts(storage, OWNER, POST, after(1000));
    expect(drafts.map((draft) => draft.input)).toEqual([content("저장할 본문\n\n저장 중 더 쓴 문단").input]);
  });

  test("저장 성공 처리는 첨부가 다른 보관본을 남기고 다른 탭의 보관본도 지우지 않는다", async () => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key(), content("본문", [{ file: "1.png", content: JPEG }]), "sha-1", NOW);
    await saveDraft(storage, key({ tab: "tab-2" }), content("본문"), "sha-1", NOW);

    await clearSavedDraft(storage, key(), content("본문", [{ file: "1.png", content: PNG }]));
    expect((await listDrafts(storage, OWNER, POST, NOW)).map((draft) => draft.key.tab).sort()).toEqual([
      "tab-1",
      "tab-2",
    ]);
  });

  test("'버리기'는 그 보관본만 지운다", async () => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key({ tab: "tab-1" }), content("버릴 입력"), "sha-1", NOW);
    await saveDraft(storage, key({ tab: "tab-2" }), content("남길 입력"), "sha-1", NOW);

    await discardDraft(storage, key({ tab: "tab-1" }));
    expect((await listDrafts(storage, OWNER, POST, NOW)).map((draft) => draft.key.tab)).toEqual(["tab-2"]);
  });
});

describe("복구 판단", () => {
  const draft = async (baseSha: string | null) => {
    const { storage } = memoryStorage();
    await saveDraft(storage, key(), content("보관한 본문"), baseSha, NOW);
    return (await listDrafts(storage, OWNER, POST, NOW))[0]!;
  };

  test("보관본의 기준 sha가 현재 글 sha와 같으면 복구 가능이다", async () => {
    const restore = checkRestore(await draft("sha-1"), { sha: "sha-1", trashed: false });
    expect(restore.kind).toBe("restorable");
  });

  test("새 글 보관본은 원격 글이 없으면 복구 가능이다", async () => {
    expect(checkRestore(await draft(null), null).kind).toBe("restorable");
  });

  test("기준 sha가 현재 글 sha와 다르면 보관 내용을 담은 충돌이다", async () => {
    const restore = checkRestore(await draft("sha-1"), { sha: "sha-2", trashed: false });
    expect(restore).toMatchObject({
      kind: "conflict",
      reason: "changed",
      draft: { input: content("보관한 본문").input },
    });
  });

  test("원격 글이 없어졌으면 충돌이다", async () => {
    expect(checkRestore(await draft("sha-1"), null)).toMatchObject({ kind: "conflict", reason: "changed" });
  });

  test("글이 휴지통에 있으면 sha가 같아도 보관 내용을 담은 충돌이다", async () => {
    const restore = checkRestore(await draft("sha-1"), { sha: "sha-1", trashed: true });
    expect(restore).toMatchObject({
      kind: "conflict",
      reason: "trashed",
      draft: { input: content("보관한 본문").input },
    });
  });
});

describe("보관 실패", () => {
  test("저장소 쓰기가 실패하면 실패 결과이고 이전 보관본은 그대로다", async () => {
    const { storage, items, block } = memoryStorage();
    await saveDraft(storage, key(), content("이전 입력"), "sha-1", NOW);
    block();

    const result = await saveDraft(storage, key(), content("새 입력"), "sha-1", after(1000));
    expect(result).toEqual({ ok: false, reason: "storage" });
    expect([...items.values()].map((draft) => draft.input)).toEqual([content("이전 입력").input]);
  });

  test("첨부를 담지 못하면 텍스트만 보관하고 빠진 첨부 이름을 돌려준다", async () => {
    const { storage } = memoryStorage({ quota: 0 });
    const attachments = [
      { file: "1.png", content: PNG },
      { file: "2.jpg", content: JPEG },
    ];

    const result = await saveDraft(storage, key(), content("본문", attachments), "sha-1", NOW);
    expect(result).toEqual({ ok: true, savedAt: NOW.getTime(), missing: ["1.png", "2.jpg"] });
    const [draft] = await listDrafts(storage, OWNER, POST, NOW);
    expect(draft).toMatchObject({ input: content("본문").input, attachments: [], missing: ["1.png", "2.jpg"] });
  });

  test("텍스트만 보관된 뒤 첨부를 포함해 저장에 성공하면 저장 성공 처리가 그 보관본을 지운다", async () => {
    const { storage } = memoryStorage({ quota: 0 });
    const saved = content("본문", [{ file: "1.png", content: PNG }]);
    await saveDraft(storage, key(), saved, "sha-1", NOW);

    await clearSavedDraft(storage, key(), saved);
    expect(await listDrafts(storage, OWNER, POST, NOW)).toEqual([]);
  });

  test("텍스트만 보관된 보관본도 저장한 뒤 본문이 달라졌으면 저장 성공 처리가 남긴다", async () => {
    const { storage } = memoryStorage({ quota: 0 });
    await saveDraft(storage, key(), content("본문\n\n더 쓴 문단", [{ file: "1.png", content: PNG }]), "sha-1", NOW);

    await clearSavedDraft(storage, key(), content("본문", [{ file: "1.png", content: PNG }]));
    expect(await listDrafts(storage, OWNER, POST, NOW)).toHaveLength(1);
  });

  test("첨부까지 담으면 빠진 첨부가 없다", async () => {
    const { storage } = memoryStorage();
    const result = await saveDraft(storage, key(), content("본문", [{ file: "1.png", content: PNG }]), "s", NOW);
    expect(result).toEqual({ ok: true, savedAt: NOW.getTime(), missing: [] });
  });

  test("준비 중인 이미지는 보관 대상에 들어가지 않고 준비가 끝난 첨부만 크기와 함께 들어간다", async () => {
    const doc = parseMdx(SOURCE);
    const pending: (() => void)[] = [];
    const prepare = (file: { name: string }) =>
      new Promise<PreparedImage>((resolve) => {
        const prepared = { extension: "png", content: PNG, width: 10, height: 20 };
        if (file.name === "ready.png") resolve(prepared);
        else pending.push(() => resolve(prepared));
      });
    const session = createUploadSession({ doc, files: [], prepare });
    await session.add([{ name: "ready.png" }], () => {});
    void session.add([{ name: "preparing.png" }], () => {});

    expect(session.preparing).toBe(true);
    const [ready] = session.plan.images;
    expect(draftAttachments(session)).toEqual([{ file: ready!.file, content: PNG, width: 10, height: 20 }]);
  });
});
