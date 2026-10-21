import { describe, expect, test } from "vitest";

import { readImageImports } from "@/lib/mdx-doc";
import { yjshdConfig } from "@/test/config";
import { memoryStorage } from "@/test/draft-storage";
import { PNG } from "@/test/upload-images";

import { discardDraft, listDrafts, saveDraft, type DraftContent, type DraftKey } from "./draft";
import { DRAFT_RESTORE_LIMIT, draftChoices, restoreDraft } from "./draft-restore";
import type { SwitchPost } from "./mode-switch";
import { findCollection } from "./read";

const config = yjshdConfig();
const PATH = "content/4.게시판/1.휴진/page.mdx";
const SOURCE = `import image1 from "./1.png";

export const metadata = {
  title: "11월 휴진 안내",
  description: "",
  keywords: [],
  other: {
    createdAt: "2020-11-20T00:00:00Z",
    status: "draft",
  },
};

# 11월 휴진 안내

<Image src={image1} alt="" />
`;

const found = findCollection(config, PATH);
if (!found) throw new Error("컬렉션에 없는 경로");
const POST: SwitchPost = { collection: found.collection, syntax: config.syntax, source: SOURCE, files: ["1.png"] };

const NOW = new Date("2026-10-20T00:00:00Z");
const OWNER = { login: "alice", repo: "es-kimo/yjshd", branch: "main" };
const DOC = { kind: "post", path: PATH } as const;
const key = (tab: string): DraftKey => ({ ...OWNER, doc: DOC, tab });

const FORM_DRAFT: DraftContent = {
  input: { mode: "form", values: { title: "12월 휴진 안내", description: "연말" }, body: "# 12월 휴진 안내\n" },
  form: null,
  attachments: [],
};

/** 보관본을 저장소에 넣고 다시 연 화면처럼 목록으로 읽는다. */
const stored = async (saved: DraftContent, baseSha: string | null, options: { quota?: number } = {}) => {
  const { storage } = memoryStorage(options);
  await saveDraft(storage, key("tab-1"), saved, baseSha, NOW);
  return { storage, drafts: await listDrafts(storage, OWNER, DOC, NOW) };
};

describe("복구 안내", () => {
  test("기준 글이 같으면 보관 시각과 대상을 보이고 ‘복구’·‘버리기’를 둔다", async () => {
    const { drafts } = await stored(FORM_DRAFT, "sha-1");

    const [choice] = draftChoices(drafts, { sha: "sha-1", trashed: false }, POST);

    expect(choice).toMatchObject({ kind: "restorable", actions: ["restore", "discard"] });
    expect(choice?.message).toBe("2026-10-20 09:00에 이 브라우저에 보관한 입력이 있어요.");
    expect(choice?.target).toBe("‘12월 휴진 안내’ · 일반 편집 입력");
  });

  test("복구는 저장 요청을 만들지 않고 보관한 입력을 편집기에 열 입력으로만 돌려준다", async () => {
    const { drafts } = await stored(FORM_DRAFT, "sha-1");

    expect(restoreDraft(POST, drafts[0]!)).toEqual({
      mode: "wysiwyg",
      input: { values: { title: "12월 휴진 안내", description: "연말" }, body: "# 12월 휴진 안내\n", images: [] },
      doc: expect.objectContaining({ ok: true }),
    });
  });

  test("일반 편집 보관본의 첨부는 편집기가 본문 이미지로 읽도록 연 원문에 import를 더해 돌려준다", async () => {
    const attachments = [{ file: "2.png", content: PNG, width: 10, height: 20 }];
    const body = '# 12월 휴진 안내\n\n<Image src={image2} alt="새 이미지" />\n';
    const { drafts } = await stored({ ...FORM_DRAFT, input: { mode: "form", values: {}, body }, attachments }, "s");

    const restored = restoreDraft(POST, drafts[0]!);

    expect(restored.mode).toBe("wysiwyg");
    if (restored.mode !== "wysiwyg") return;
    expect(restored.input.images).toEqual(attachments);
    expect(readImageImports(restored.doc).map((image) => image.path)).toEqual(["./1.png", "./2.png"]);
  });

  test("원문 편집 보관본은 원문 편집으로, 새 글의 하위 메뉴와 함께 연다", async () => {
    const submenu = { kind: "existing", name: "1.휴진" } as const;
    const source = SOURCE.replace("11월 휴진 안내", "원문에서 고친 제목");
    const { drafts } = await stored({ input: { mode: "source", source, submenu }, form: null, attachments: [] }, null);

    expect(restoreDraft(POST, drafts[0]!)).toEqual({ mode: "source", input: { source, images: [] }, submenu });
    expect(draftChoices(drafts, null, POST)[0]?.target).toBe("‘원문에서 고친 제목’ · 원문 편집 입력");
  });

  test("보관한 뒤 글이 바뀌었으면 자동으로 복구하지 않고 지금 글과 비교해 보관 내용을 복사하게 한다", async () => {
    const { drafts } = await stored(FORM_DRAFT, "sha-1");

    const [choice] = draftChoices(drafts, { sha: "sha-2", trashed: false }, POST);

    expect(choice).toMatchObject({ kind: "conflict", reason: "changed", actions: ["copy", "discard"] });
    expect(choice?.message).toContain("다른 곳에서 글이 바뀌어 바로 복구하지 않아요");
    expect(choice?.archived).toBe("제목: 12월 휴진 안내\n요약: 연말\n\n# 12월 휴진 안내\n");
  });

  test("휴지통 글이면 기준 글이 같아도 자동으로 복구하지 않고 보관 내용을 복사하게 한다", async () => {
    const source: DraftContent = { input: { mode: "source", source: SOURCE }, form: null, attachments: [] };
    const { drafts } = await stored(source, "sha-1");

    const [choice] = draftChoices(drafts, { sha: "sha-1", trashed: true }, POST);

    expect(choice).toMatchObject({ kind: "conflict", reason: "trashed", actions: ["copy", "discard"] });
    expect(choice?.message).toContain("글이 휴지통에 있어 바로 복구하지 않아요");
    expect(choice?.archived).toBe(SOURCE);
  });

  test("텍스트만 보관된 보관본은 복구한 뒤 다시 골라야 할 첨부 이름을 함께 알린다", async () => {
    const attachments = [{ file: "2.png", content: PNG }];
    const { drafts } = await stored({ ...FORM_DRAFT, attachments }, "sha-1", { quota: 0 });

    const [choice] = draftChoices(drafts, { sha: "sha-1", trashed: false }, POST);

    expect(choice?.message).toContain("이미지 1개(2.png)는 보관하지 못했어요. 복구한 뒤 이미지를 다시 골라 주세요.");
  });

  test("‘버리기’를 고른 보관본은 다시 열어도 나오지 않고 다른 탭의 보관본은 남는다", async () => {
    const { storage } = await stored(FORM_DRAFT, "sha-1");
    await saveDraft(storage, key("tab-2"), FORM_DRAFT, "sha-1", new Date(NOW.getTime() + 1000));
    const before = draftChoices(await listDrafts(storage, OWNER, DOC, NOW), { sha: "sha-1", trashed: false }, POST);
    expect(before.map((choice) => choice.draft.key.tab)).toEqual(["tab-2", "tab-1"]);

    await discardDraft(storage, before[1]!.draft.key);

    const after = await listDrafts(storage, OWNER, DOC, NOW);
    expect(after.map((draft) => draft.key.tab)).toEqual(["tab-2"]);
  });
});

describe("복구 안내의 보장 범위", () => {
  test("보관본이 마지막 보관 뒤 30일이 지나면 지워진다는 것과 다른 기기·브라우저에서는 복구할 수 없다는 것을 함께 알린다", () => {
    expect(DRAFT_RESTORE_LIMIT).toContain("마지막으로 보관한 뒤 30일이 지나면 지워져요");
    expect(DRAFT_RESTORE_LIMIT).toContain("다른 기기나 다른 브라우저");
  });
});
