import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { parseMdx, readImageImports, readMetadata } from "@/lib/mdx-doc";
import { buildForm } from "@/lib/metadata-form";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";
import { PNG } from "@/test/upload-images";

import { applyInsertForm } from "./insert-form";
import { formToSource, sourceToForm, type SwitchPost } from "./mode-switch";
import { editorModes, findCollection } from "./read";
import { saveEdit } from "./save-edit";
import { sourceUploads } from "./upload";
import { createUploadSession } from "./upload-session";

const config = yjshdConfig();
const POST = "content/4.게시판/1.휴진/page.mdx";

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

안녕하세요.

<Image src={image1} alt="" />
`;

/** 화면에서 손대지 않은 설정 폼 값. */
const FORM = { title: "11월 휴진 안내", description: "", keywords: "", "other.createdAt": "2020-11-20T00:00:00" };

const switchPost = (source = SOURCE, path = POST): SwitchPost => {
  const found = findCollection(config, path);
  if (!found) throw new Error("컬렉션에 없는 경로");
  return { collection: found.collection, syntax: config.syntax, source, files: ["1.png"] };
};

const post = switchPost();

/** 원문 편집 입력에서 한 곳을 바꾼다. */
const sourceWith = (from: string, to: string) => {
  if (!SOURCE.includes(from)) throw new Error(`원문에 없는 글자: ${from}`);
  return SOURCE.replace(from, to);
};

describe("formToSource → sourceToForm 왕복", () => {
  test("yjshd 글에서 일반 편집으로 제목·설정·본문을 고치고 원문으로 바꾼 뒤 다시 일반 편집으로 바꾸면 처음 고친 입력과 같다", () => {
    const edited = {
      values: {
        title: "12월 휴진 안내",
        description: "12월 휴진 일정이에요.",
        keywords: "휴진\n공지",
        "other.createdAt": "2020-12-01T09:30:00",
      },
      body: '# 12월 휴진 안내\n\n12월에는 쉬어요.\n\n<Image src={image1} alt="" />\n',
      images: [],
    };

    const source = formToSource(post, edited);
    if (!source.ok) throw new Error(source.reason);
    expect(source.input.source).toContain('title: "12월 휴진 안내"');
    expect(source.input.source).toContain("12월에는 쉬어요.");

    const back = sourceToForm(post, source.input);
    if (!back.ok) throw new Error(back.reason);
    expect(back.input).toEqual(edited);
  });

  test("일반 편집 입력을 고치지 않고 원문으로 바꾸면 연 원문 그대로다", () => {
    const source = formToSource(post, { values: FORM, body: parseBody(SOURCE), images: [] });
    expect(source).toEqual({ ok: true, input: { source: SOURCE, images: [] } });
  });
});

describe("sourceToForm", () => {
  test("원문에서 고친 본문과 metadata가 일반 편집 입력으로 이어진다", () => {
    const source = sourceWith('title: "11월 휴진 안내"', 'title: "11월 휴진 일정"').replace(
      "안녕하세요.",
      "안녕하세요. 휴진 일정을 알려 드려요.",
    );

    const result = sourceToForm(post, { source, images: [] });

    if (!result.ok) throw new Error(result.reason);
    expect(result.input.values).toEqual({ ...FORM, title: "11월 휴진 일정" });
    expect(result.input.body).toContain("휴진 일정을 알려 드려요.");
  });

  test("원문에서 바꾼 게시 상태는 저장 행동이 정하므로 전환을 막지 않고 이어받지도 않는다", () => {
    const result = sourceToForm(post, { source: sourceWith('status: "draft"', 'status: "ready"'), images: [] });

    expect(result.ok && result.input.values).toEqual(FORM);
  });

  test("일반 편집으로 열 수 없는 원문은 기존 제한 이유와 함께 전환 실패다", () => {
    const cases = [
      // 글 설정과 본문으로 나눌 수 없다.
      { source: sourceWith("export const metadata = {", "export const metadata = {{"), reason: "doc" },
      // 글 설정을 폼으로 읽을 수 없다.
      { source: sourceWith('title: "11월 휴진 안내"', "title: someTitle"), reason: "metadata" },
      // 일반 편집이 담지 못하는 가져오기를 더했다.
      {
        source: sourceWith('import image1 from "./1.png";', 'import image1 from "./1.png";\nimport x from "./x";'),
        reason: "lossy",
      },
      // 폼에 없는 설정을 더했다.
      { source: sourceWith('  description: "",', '  description: "",\n  author: "원장",'), reason: "lossy" },
      // 폼에서 줄바꿈 없는 한 줄로만 고치는 제목에 줄바꿈을 넣었다.
      { source: sourceWith('title: "11월 휴진 안내"', 'title: "11월\\n휴진 안내"'), reason: "lossy" },
    ];
    for (const { source, reason } of cases) {
      expect(sourceToForm(post, { source, images: [] }), source).toMatchObject({ ok: false, reason });
    }
  });

  test("전환에 실패해도 받은 입력을 바꾸지 않는다", () => {
    const input = { source: sourceWith("export const metadata = {", "export const metadata = {{"), images: [] };
    const before = structuredClone(input);

    sourceToForm(post, input);

    expect(input).toEqual(before);
  });
});

describe("모드 전환과 새 이미지", () => {
  const image = { file: "2.png", content: PNG, width: 10, height: 20 };
  const body = `${parseBody(SOURCE)}\n<Image src={image2} alt="안내문" />\n`;

  test("일반 편집에서 넣은 새 이미지가 원문으로 넘어갈 때 import와 첨부가 함께 이어지고, 저장 요청에는 그 첨부가 한 번만 담긴다", async () => {
    const source = formToSource(post, { values: FORM, body, images: [image] });
    if (!source.ok) throw new Error(source.reason);
    expect(source.input.source).toContain('import image2 from "./2.png";');
    expect(source.input.images).toEqual([image]);

    // 원문 편집기는 이어받은 첨부를 처음부터 든 세션으로 다시 열린다.
    const session = createUploadSession({
      doc: parseMdx(source.input.source, config.syntax),
      files: post.files,
      prepare: async () => null,
      used: sourceUploads,
      attachments: source.input.images,
    });
    const submission = session.submission(source.input.source);
    expect(submission).toEqual({ ok: true, images: [{ file: "2.png", content: PNG }] });
    expect(session.sizes.get("2.png")).toEqual({ width: 10, height: 20 });

    const repo = fakeGitRepo("es-kimo/yjshd", "main", [
      { path: POST, content: SOURCE },
      { path: "content/4.게시판/1.휴진/1.png", content: PNG },
    ]);
    const before = repo.log().length;
    const result = await saveEdit(createGitHubClient("t", repo.fetch), "es-kimo/yjshd", config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      action: "save-draft",
      content: { mode: "source", source: source.input.source, images: submission.ok ? submission.images : [] },
    });
    expect(result.ok).toBe(true);
    expect(repo.log()).toHaveLength(before + 1);
    expect(repo.file("content/4.게시판/1.휴진/2.png")).toEqual(PNG);
  });

  test("원문으로 넘어간 새 이미지는 다시 일반 편집으로 바꾸면 import를 더한 doc과 함께 첨부로 돌아온다", () => {
    const source = formToSource(post, { values: FORM, body, images: [image] });
    if (!source.ok) throw new Error(source.reason);

    const back = sourceToForm(post, source.input);

    if (!back.ok) throw new Error(back.reason);
    expect(back.input).toEqual({ values: FORM, body, images: [image] });
    expect(readImageImports(back.doc).map((image) => image.path)).toContain("./2.png");
  });

  test("원문 편집에서 넣은 새 이미지도 일반 편집으로 이어진다", () => {
    // 원문 편집이 이미지를 넣는 것처럼 본문 끝에 import와 함께 넣는다.
    const at = { from: SOURCE.length, to: SOURCE.length };
    const inserted = applyInsertForm(
      SOURCE,
      { kind: "image", image: { file: "2.png", name: "image2" }, place: { at, opened: SOURCE } },
      { text: "안내문", ids: [] },
      config.syntax,
    );
    if (!inserted.ok) throw new Error(inserted.reason);
    const { source } = inserted;

    const result = sourceToForm(post, { source, images: [image] });

    if (!result.ok) throw new Error(result.reason);
    expect(result.input.images).toEqual([image]);
    expect(result.input.body).toContain("<Image src={image2}");
  });

  test("원문이 가리키지 않는 첨부는 일반 편집으로 이어받지 않는다", () => {
    const result = sourceToForm(post, { source: SOURCE, images: [image] });

    expect(result.ok && result.input.images).toEqual([]);
  });
});

const fixtures = loadFixtures("yjshd");

describe("픽스처 전체", () => {
  test.skipIf(!fixtures)(
    "일반 편집으로 여는 yjshd 글은 손대지 않은 입력을 원문으로 바꾸면 원문 그대로이고, 원문을 일반 편집으로 바꾸면 처음 폼 값과 본문이다",
    () => {
      const targets = (fixtures ?? []).flatMap((fixture) => {
        const path = `content/${fixture.path}`;
        const found = findCollection(config, path);
        if (!found) return [];
        const doc = parseMdx(fixture.source, config.syntax);
        const metadata = readMetadata(doc);
        if (editorModes({ doc, metadata, collection: found.collection }).sourceOnly || !doc.ok) return [];
        return [{ path, source: fixture.source, body: doc.body, metadata }];
      });
      expect(targets.length).toBeGreaterThan(100);

      const failures: string[] = [];
      for (const { path, source, body, metadata } of targets) {
        const switching = switchPost(source, path);
        const fields = metadata?.editable ? buildForm(switching.collection, metadata.value) : [];
        const values = Object.fromEntries(
          fields.flatMap((field) => (field.locked ? [] : [[field.key, field.initial]])),
        );

        const toSource = formToSource(switching, { values, body, images: [] });
        const toForm = sourceToForm(switching, { source, images: [] });
        if (!toSource.ok || toSource.input.source !== source)
          failures.push(`${path}: 원문으로 ${JSON.stringify(toSource)}`);
        if (!toForm.ok || JSON.stringify(toForm.input) !== JSON.stringify({ values, body, images: [] })) {
          failures.push(`${path}: 일반 편집으로 ${JSON.stringify(toForm)}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );
});

function parseBody(source: string): string {
  const doc = parseMdx(source, config.syntax);
  if (!doc.ok) throw new Error(doc.message);
  return doc.body;
}
