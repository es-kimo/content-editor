import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { parseMdx, readMetadata } from "@/lib/mdx-doc";
import { readStatus } from "@/lib/metadata-form";
import { blogConfig, testConfig, yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha, type FakeFile } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";
import { GIF, PNG } from "@/test/upload-images";

import { findCollection } from "./read";
import { BODY_FIELD, saveEdit, type EditContent, type SaveEditInput } from "./save-edit";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";
const IMAGE = "content/4.게시판/1.휴진/2.png";

/** 실제 yjshd에 넣을 config 예시. 완료 기준을 이 config로 확인한다. */
const config = yjshdConfig();

const post = (status: string, body = '# 11월 휴진 안내\n\n안녕하세요.\n\n<Image src={image1} alt="" />\n') =>
  `import image1 from "./1.png";

export const metadata = {
  title: "11월 휴진 안내",
  description: "",
  keywords: [],
  other: {
    createdAt: "2020-11-20T00:00:00Z",
    status: "${status}",
  },
};

${body}`;

const DRAFT = post("draft");
const READY = post("ready");

const BODY = '# 11월 휴진 안내\n\n휴진을 알려 드립니다.\n\n<Image src={image1} alt="" />\n';
const BODY_WITH_IMAGE = `${BODY}\n<Image src={image2} alt="안내문" />\n`;

const setup = (files: FakeFile[]) => {
  const repo = fakeGitRepo(REPO, "main", [
    ...files,
    { path: "content/4.게시판/1.휴진/1.png", content: PNG },
    { path: "README.md", content: "# yjshd\n" },
  ]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

/** 저장된 글의 metadata. */
const metadataOf = (source: string, syntax = config.syntax) => {
  const metadata = readMetadata(parseMdx(source, syntax));
  if (!metadata?.editable) throw new Error("metadata를 읽을 수 없다");
  return metadata.value;
};

const bodyOf = (source: string) => {
  const doc = parseMdx(source, config.syntax);
  if (!doc.ok) throw new Error(doc.message);
  return doc.body;
};

/** 화면에서 손대지 않은 설정 폼 값. */
const FORM = { title: "11월 휴진 안내", description: "", keywords: "", "other.createdAt": "2020-11-20T00:00:00" };

const form = (values: { [key: string]: string }, body: string): EditContent => ({
  mode: "form",
  values: { ...FORM, ...values },
  body,
});

/** `source` 글 하나가 있는 레포를 만들고, 그 글을 연 sha로 저장한다. */
const save = (source: string, input: { action: SaveEditInput["action"]; content?: EditContent }) => {
  const { repo, client } = setup([{ path: POST, content: source }]);
  const before = repo.head();
  const result = saveEdit(client, REPO, config, { path: POST, baseSha: blobSha(source), ...input } as SaveEditInput);
  return { repo, before, result };
};

describe("saveEdit 임시저장", () => {
  test("초안 글에 설정·본문·새 이미지를 함께 임시저장하면 커밋 1개에 세 변경이 모두 담기고 상태는 draft다", async () => {
    const { repo, before, result } = save(DRAFT, {
      action: "save-draft",
      content: {
        mode: "form",
        values: { ...FORM, title: "12월 휴진 안내", description: "12월 휴진을 알려 드립니다." },
        body: BODY_WITH_IMAGE,
        images: [{ file: "2.png", content: PNG }],
      },
    });

    expect(await result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(repo.log()[0]!.message).toBe("post: 12월 휴진 안내");
    const saved = text(repo.file(POST));
    expect(metadataOf(saved)).toMatchObject({ title: "12월 휴진 안내", description: "12월 휴진을 알려 드립니다." });
    expect(readStatus(metadataOf(saved))).toBe("draft");
    expect(bodyOf(saved)).toBe(BODY_WITH_IMAGE);
    expect(saved).toContain('import image2 from "./2.png";');
    expect(repo.file(IMAGE)).toEqual(PNG);
  });

  test("원문 입력도 원문과 새 이미지를 커밋 1개로 저장한다", async () => {
    const edited = `import image2 from "./2.png";\n${DRAFT.replace("안녕하세요.", '휴진을 알려 드립니다.\n\n<Image src={image2} alt="" />')}`;
    const { repo, before, result } = save(DRAFT, {
      action: "save-draft",
      content: { mode: "source", source: edited, images: [{ file: "2.png", content: PNG }] },
    });

    expect(await result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(text(repo.file(POST))).toBe(edited);
    expect(repo.file(IMAGE)).toEqual(PNG);
  });

  test("바뀐 것이 없으면 일반 편집이든 원문이든 커밋하지 않는다", async () => {
    for (const content of [form({}, bodyOf(DRAFT)), { mode: "source", source: DRAFT } as const]) {
      const { repo, before, result } = save(DRAFT, { action: "save-draft", content });

      expect(await result).toEqual({ ok: false, reason: "unchanged" });
      expect(repo.head()).toBe(before);
    }
  });

  test("제목만 있고 본문이 빈 초안도 임시저장한다", async () => {
    const { repo, result } = save(DRAFT, { action: "save-draft", content: form({}, "") });

    expect((await result).ok).toBe(true);
    expect(bodyOf(text(repo.file(POST)))).toBe("");
  });

  test("게시 대상 글의 임시저장 요청은 커밋 없이 거절한다", async () => {
    const { repo, before, result } = save(READY, { action: "save-draft", content: form({}, BODY) });

    expect(await result).toEqual({ ok: false, reason: "action" });
    expect(repo.head()).toBe(before);
  });
});

describe("saveEdit 게시 상태 전환", () => {
  test("초안을 게시하면 내용과 함께 ready로 저장한다", async () => {
    const { repo, result } = save(DRAFT, { action: "publish", content: form({}, BODY) });

    expect((await result).ok).toBe(true);
    expect(repo.log()).toHaveLength(2);
    const saved = text(repo.file(POST));
    expect(readStatus(metadataOf(saved))).toBe("ready");
    expect(bodyOf(saved)).toBe(BODY);
  });

  test("게시 대상 글의 수정 반영은 ready로 저장한다", async () => {
    const { repo, result } = save(READY, { action: "update", content: form({ title: "12월 휴진 안내" }, BODY) });

    expect((await result).ok).toBe(true);
    const saved = text(repo.file(POST));
    expect(metadataOf(saved)).toMatchObject({ title: "12월 휴진 안내" });
    expect(readStatus(metadataOf(saved))).toBe("ready");
  });

  test("게시 내리기는 본문을 그대로 두고 상태만 draft로 바꾼다", async () => {
    const { repo, result } = save(READY, { action: "unpublish" });

    expect((await result).ok).toBe(true);
    expect(repo.log()).toHaveLength(2);
    expect(text(repo.file(POST))).toBe(DRAFT);
  });

  test("초안의 게시 내리기·수정 반영과 게시 대상 글의 게시는 거절한다", async () => {
    for (const [source, input] of [
      [DRAFT, { action: "unpublish" }],
      [READY, { action: "publish", content: form({}, BODY) }],
      [DRAFT, { action: "update", content: form({}, BODY) }],
    ] as const) {
      const { repo, before, result } = save(source, input);

      expect(await result).toEqual({ ok: false, reason: "action" });
      expect(repo.head()).toBe(before);
    }
  });

  test("폼 값에서 상태를 바꿔 보내도 행동이 정한 상태로 저장한다", async () => {
    const draft = save(DRAFT, { action: "save-draft", content: form({ "other.status": "ready" }, BODY) });
    expect((await draft.result).ok).toBe(true);
    expect(readStatus(metadataOf(text(draft.repo.file(POST))))).toBe("draft");

    const update = save(READY, { action: "update", content: form({ "other.status": "draft" }, BODY) });
    expect((await update.result).ok).toBe(true);
    expect(readStatus(metadataOf(text(update.repo.file(POST))))).toBe("ready");
  });

  test("원문에서 상태를 바꿔 보내도 행동이 정한 상태로 저장한다", async () => {
    const draft = save(DRAFT, { action: "save-draft", content: { mode: "source", source: post("ready", BODY) } });
    expect((await draft.result).ok).toBe(true);
    expect(text(draft.repo.file(POST))).toBe(post("draft", BODY));

    const update = save(READY, { action: "update", content: { mode: "source", source: post("hidden", BODY) } });
    expect((await update.result).ok).toBe(true);
    expect(text(update.repo.file(POST))).toBe(post("ready", BODY));
  });

  test("원문에서 상태만 바꾼 저장은 상태가 그대로라 커밋하지 않는다", async () => {
    const { repo, before, result } = save(DRAFT, { action: "save-draft", content: { mode: "source", source: READY } });

    expect(await result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });
});

describe("saveEdit 필수 값", () => {
  test.each(["publish", "update"] as const)(
    "%s에서 제목이나 본문이 비면 커밋 없이 필드 오류를 돌려준다",
    async (action) => {
      const source = action === "publish" ? DRAFT : READY;
      const { repo, before, result } = save(source, { action, content: form({ title: " " }, "\n") });

      const saved = await result;
      expect(saved.ok).toBe(false);
      expect(saved.ok === false && saved.reason === "invalid" && saved.errors.map((e) => e.key).sort()).toEqual([
        BODY_FIELD,
        "title",
      ]);
      expect(repo.head()).toBe(before);
    },
  );

  test("원문의 제목이나 본문이 비어도 게시하지 않는다", async () => {
    const source = post("draft", "").replace('title: "11월 휴진 안내"', 'title: ""');
    const { repo, before, result } = save(DRAFT, { action: "publish", content: { mode: "source", source } });

    const saved = await result;
    expect(saved.ok === false && saved.reason === "invalid" && saved.errors.map((e) => e.key).sort()).toEqual([
      BODY_FIELD,
      "title",
    ]);
    expect(repo.head()).toBe(before);
  });

  test("이미지 태그만 있는 본문은 게시한다", async () => {
    const { repo, result } = save(DRAFT, { action: "publish", content: form({}, '<Image src={image1} alt="" />\n') });

    expect((await result).ok).toBe(true);
    expect(readStatus(metadataOf(text(repo.file(POST))))).toBe("ready");
  });

  test("임시저장도 빈 제목은 필드 오류로 돌려준다", async () => {
    const { repo, before, result } = save(DRAFT, { action: "save-draft", content: form({ title: "" }, BODY) });

    const saved = await result;
    expect(saved.ok === false && saved.reason === "invalid" && saved.errors.map((e) => e.key)).toEqual(["title"]);
    expect(repo.head()).toBe(before);
  });
});

describe("saveEdit 상태를 다룰 수 없을 때", () => {
  const board = (metadata: Parameters<typeof testConfig>[0][number]["metadata"]) =>
    testConfig([{ name: "게시판", path: "content/4.게시판/{slug}/page.mdx", metadata }]);

  test.each([
    ["status-field", board({ title: { type: "string" } })],
    [
      "status-options",
      board({ title: { type: "string" }, "other.status": { type: "select", options: ["ready", "hidden"] } }),
    ],
  ] as const)("config가 draft·ready를 다룰 수 없으면 %s로 거절한다", async (reason, other) => {
    const { repo, client } = setup([{ path: POST, content: DRAFT }]);
    const before = repo.head();

    const result = await saveEdit(client, REPO, other, {
      path: POST,
      baseSha: blobSha(DRAFT),
      action: "save-draft",
      content: form({ title: "12월 휴진 안내" }, BODY),
    });

    expect(result).toEqual({ ok: false, reason });
    expect(repo.head()).toBe(before);
  });

  test("글의 상태가 draft·ready 밖의 값이면 어떤 행동도 status-value로 거절한다", async () => {
    const hidden = post("hidden");
    for (const input of [
      { action: "save-draft", content: form({}, BODY) },
      { action: "publish", content: { mode: "source", source: READY } },
      { action: "unpublish" },
    ] as const) {
      const { repo, before, result } = save(hidden, input);

      expect(await result).toEqual({ ok: false, reason: "status-value" });
      expect(repo.head()).toBe(before);
    }
  });

  test("고친 원문의 metadata가 리터럴이 아니면 상태를 맞출 수 없어 source-status로 거절한다", async () => {
    const source = DRAFT.replace('title: "11월 휴진 안내"', "title: `${'11월'} 휴진 안내`");
    const { repo, before, result } = save(DRAFT, { action: "save-draft", content: { mode: "source", source } });

    expect(await result).toEqual({ ok: false, reason: "source-status" });
    expect(repo.head()).toBe(before);
  });
});

describe("saveEdit 실패", () => {
  test("편집을 연 뒤 다른 곳에서 글이 바뀌었으면 changed", async () => {
    const { repo, client } = setup([{ path: POST, content: DRAFT }]);
    repo.pushElsewhere([{ path: POST, content: post("draft", "다른 곳에서 고친 본문\n") }]);
    const before = repo.head();

    const result = await saveEdit(client, REPO, config, {
      path: POST,
      baseSha: blobSha(DRAFT),
      action: "save-draft",
      content: form({}, BODY),
    });

    expect(result).toMatchObject({ ok: false, reason: "changed" });
    expect(repo.head()).toBe(before);
  });

  test("컴파일되지 않는 본문·원문은 compile", async () => {
    for (const content of [form({}, "<Image\n"), { mode: "source", source: `${DRAFT}<Image\n` } as const]) {
      const { repo, before, result } = save(DRAFT, { action: "save-draft", content });

      expect(await result).toMatchObject({ ok: false, reason: "compile" });
      expect(repo.head()).toBe(before);
    }
  });

  test("형식이 맞지 않거나 본문이 쓰지 않는 첨부는 image", async () => {
    for (const content of [
      { ...form({}, BODY_WITH_IMAGE), images: [{ file: "2.png", content: GIF }] },
      { ...form({}, BODY), images: [{ file: "2.png", content: PNG }] },
      { mode: "source", source: DRAFT.replace("안녕하세요.", "고친 본문"), images: [{ file: "2.png", content: PNG }] },
    ] as EditContent[]) {
      const { repo, before, result } = save(DRAFT, { action: "save-draft", content });

      expect(await result).toMatchObject({ ok: false, reason: "image", file: "2.png" });
      expect(repo.head()).toBe(before);
    }
  });

  test("검사 뒤 ref 갱신 전에 브랜치가 앞서 나가면 not-fast-forward이고 글은 그대로다", async () => {
    const { repo } = setup([{ path: POST, content: DRAFT }]);
    let elsewhere = "";
    const client = createGitHubClient("t", async (input, init) => {
      if (init?.method === "PATCH") {
        repo.pushElsewhere([{ path: "README.md", content: "# 끼어든 커밋\n" }]);
        elsewhere = repo.head();
      }
      return repo.fetch(input, init);
    });

    const result = await saveEdit(client, REPO, config, {
      path: POST,
      baseSha: blobSha(DRAFT),
      action: "publish",
      content: form({}, BODY),
    });

    expect(result).toEqual({ ok: false, reason: "not-fast-forward" });
    expect(repo.head()).toBe(elsewhere);
    expect(text(repo.file(POST))).toBe(DRAFT);
  });
});

const yjshd = loadFixtures("yjshd") ?? [];
const blog = loadFixtures("blog") ?? [];

describe("픽스처 전체", () => {
  test.skipIf(yjshd.length === 0)(
    "yjshd 게시 대상 글을 게시 내리면 상태 말고는 metadata와 본문이 그대로다",
    async () => {
      const targets = yjshd
        .map((fixture) => ({ ...fixture, filePath: `content/${fixture.path}` }))
        .filter(
          ({ filePath, source }) => findCollection(config, filePath) && readStatus(metadataOf(source)) === "ready",
        );
      expect(targets.length).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const { path, filePath, source } of targets) {
        const { repo, client } = setup([{ path: filePath, content: source }]);

        const result = await saveEdit(client, REPO, config, {
          path: filePath,
          baseSha: blobSha(source),
          action: "unpublish",
        });
        const saved = text(repo.file(filePath));
        const after = metadataOf(saved);
        const restored = { ...after, other: { ...(after.other as object), status: "ready" } };
        if (
          !result.ok ||
          readStatus(after) !== "draft" ||
          bodyOf(saved) !== bodyOf(source) ||
          JSON.stringify(restored) !== JSON.stringify(metadataOf(source))
        ) {
          failures.push(`${path}: ${JSON.stringify(result)}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  test.skipIf(blog.length === 0)("blog 글을 원문 그대로 저장하면 상태에 맞는 행동에서 커밋하지 않는다", async () => {
    const blogConf = blogConfig();
    const failures: string[] = [];
    for (const fixture of blog) {
      const filePath = `apps/blog/content/${fixture.path}`;
      const repo = fakeGitRepo(REPO, blogConf.branch, [{ path: filePath, content: fixture.source }]);
      const client = createGitHubClient("t", repo.fetch);
      const status = readStatus(metadataOf(fixture.source, blogConf.syntax));

      const result = await saveEdit(client, REPO, blogConf, {
        path: filePath,
        baseSha: blobSha(fixture.source),
        action: status === "ready" ? "update" : "save-draft",
        content: { mode: "source", source: fixture.source },
      });
      if (result.ok || result.reason !== "unchanged") failures.push(`${fixture.path}: ${JSON.stringify(result)}`);
    }
    expect(failures).toEqual([]);
  });
});
