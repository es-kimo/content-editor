import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { parseEditorConfig, type EditorConfig } from "@/lib/editor-config";
import { createGitHubClient } from "@/lib/github";
import { checkMdx, editedBody, imageTag, parseMdx, readImageImports } from "@/lib/mdx-doc";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha, type FakeFile } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";

import { applyBodyInsertForm, bodyImageReplace, bodyInserts, isImageInsert, removeBodyInsert } from "./insert-form";
import { editorKeys, findCollection, readPost } from "./read";
import { saveBody } from "./save-body";
import { addUpload, IMAGE_COMPONENT, MAX_UPLOAD_BYTES, usedUploads, type UploadPlan } from "./upload";
import { createUploadSession, type AddedUpload } from "./upload-session";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";

/** 실제 yjshd에 넣을 config 예시. 완료 기준을 이 config로 확인한다. */
const config: EditorConfig = (() => {
  const file = path.resolve(import.meta.dirname, "../../../docs/editor-config/yjshd.editor.config.json");
  const result = parseEditorConfig(readFileSync(file, "utf8"));
  if (!result.ok) throw new Error("config 오류");
  return result.config;
})();

const HEAD = `import image1 from "./1.png";

export const metadata = {
  title: '11월 휴진 안내',
  keywords: [],
  other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" },
};

`;
const SOURCE = `${HEAD}# 11월 휴진 안내

안녕하세요.

<Image src={image1} alt="" />
`;

/** 공지 글에서 문단·목록·굵게·링크를 고친 본문. */
const EDITED = `# 11월 휴진 안내

안녕하세요. 다음과 같이 **외래 진료 휴진**을 안내드립니다.

- 11월 17일 (화요일)
- 11월 28일 (토요일)

자세한 내용은 [진료 시간](https://example.com/hours)을 봅니다.

<Image src={image1} alt="" />
`;

const setup = (files: FakeFile[]) => {
  const repo = fakeGitRepo(REPO, "main", [...files, { path: "README.md", content: "# yjshd\n" }]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

const bodyOf = (source: string) => {
  const doc = parseMdx(source, config.syntax);
  if (!doc.ok) throw new Error(doc.message);
  return doc.body;
};

describe("saveBody", () => {
  test("공지 글의 문단·목록·굵게·링크를 고쳐 저장하면 커밋 1개에 본문만 바뀐다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body: EDITED });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(repo.log()[0]!.message).toBe("post: 11월 휴진 안내");
    expect(text(repo.file(POST))).toBe(HEAD + EDITED);
  });

  test("본문을 저장해도 metadata 영역의 key는 그대로라 고치던 폼 입력이 남는다", async () => {
    const { client } = setup([{ path: POST, content: SOURCE }]);
    const before = (await readPost(client, REPO, config, POST))!;

    await saveBody(client, REPO, config, { path: POST, baseSha: before.sha, body: EDITED });
    const after = (await readPost(client, REPO, config, POST))!;

    expect(after.sha).not.toBe(before.sha);
    expect(editorKeys(after).metadata).toBe(editorKeys(before).metadata);
    expect(editorKeys(after).body).not.toBe(editorKeys(before).body);
  });

  test("에디터가 끝 줄바꿈을 뗀 본문을 내보내도 파일 끝 줄바꿈을 지킨다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const body = editedBody(bodyOf(SOURCE), null, EDITED.trim());

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body });

    expect(result.ok).toBe(true);
    expect(text(repo.file(POST))).toBe(HEAD + EDITED);
  });

  test("에디터에서 고쳤다가 되돌린 본문은 끝 줄바꿈이 없어도 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();
    const body = editedBody(bodyOf(SOURCE), null, bodyOf(SOURCE).trim());

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });

  test("본문이 원본과 같으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body: bodyOf(SOURCE) });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });

  test("편집 화면을 연 뒤 다른 곳에서 글을 고쳤으면 저장하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    repo.pushElsewhere([{ path: POST, content: SOURCE.replace("안녕하세요.", "다른 곳에서 고친 본문") }]);
    const head = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body: EDITED });

    expect(result).toMatchObject({ ok: false, reason: "changed" });
    expect(repo.head()).toBe(head);
  });

  test("고친 본문이 컴파일되지 않으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      body: "# 제목\n\n<Image src={image1}\n",
    });

    expect(result).toMatchObject({ ok: false, reason: "compile" });
    expect(repo.head()).toBe(before);
  });

  test("구간으로 나눌 수 없는 글은 저장하지 않는다", async () => {
    const source = "본문\n\nexport const a = 1;\n";
    const { repo, client } = setup([{ path: POST, content: source }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(source), body: "고친 본문\n" });

    expect(result).toMatchObject({ ok: false, reason: "not-editable" });
    expect(repo.head()).toBe(before);
  });

  test("metadata에 제목이 없으면 커밋 제목에 slug를 쓴다", async () => {
    const source = "export const metadata = {};\n\n본문\n";
    const { repo, client } = setup([{ path: POST, content: source }]);

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(source), body: "고친 본문\n" });

    expect(result.ok).toBe(true);
    expect(repo.log()[0]!.message).toBe("post: 1.휴진");
  });

  test("없는 글이면 not-found", async () => {
    const { client } = setup([{ path: POST, content: SOURCE }]);
    const result = await saveBody(client, REPO, config, {
      path: "content/4.게시판/없는글/page.mdx",
      baseSha: "x",
      body: EDITED,
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("saveBody 이미지", () => {
  const DIR = "content/4.게시판/1.휴진";
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
  const OLD_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);

  /** 편집 화면이 하는 일: 글 폴더 파일을 피해 이름을 고르고 본문에 넣을 태그를 받는다. */
  const upload = (folder: string[]) => {
    let plan: UploadPlan = { doc: parseMdx(SOURCE, config.syntax), images: [] };
    const tags = [
      { extension: "png", content: PNG },
      { extension: "jpg", content: JPEG },
    ].map((image) => {
      const added = addUpload(plan, image, folder);
      if (!added.ok) throw new Error(added.problem);
      plan = added.plan;
      return added.tag;
    });
    return { plan, tags };
  };

  test("이미지 2장을 넣은 공지를 저장하면 커밋 1개에 mdx와 이미지 2개가 담기고 import가 글 폴더 파일을 가리킨다", async () => {
    const { repo, client } = setup([
      { path: POST, content: SOURCE },
      { path: `${DIR}/1.png`, content: OLD_IMAGE },
    ]);
    const before = repo.head();
    const post = (await readPost(client, REPO, config, POST))!;
    const { plan, tags } = upload(post.images.map((image) => image.name));
    const body = `${EDITED}\n${tags[0]}\n\n${tags[1]}\n`;

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: post.sha,
      body,
      images: usedUploads(plan, body),
    });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(repo.file(`${DIR}/2.png`)).toEqual(PNG);
    expect(repo.file(`${DIR}/3.jpg`)).toEqual(JPEG);
    expect(repo.file(`${DIR}/1.png`)).toEqual(OLD_IMAGE);
    const saved = text(repo.file(POST));
    expect(saved).toBe(
      HEAD.replace(
        'import image1 from "./1.png";',
        'import image1 from "./1.png";\nimport image2 from "./2.png";\nimport image3 from "./3.jpg";',
      ) + body,
    );
    // 사이트 빌드가 이미지를 찾으려면 import한 파일이 모두 글 폴더에 있어야 한다.
    for (const image of readImageImports(parseMdx(saved, config.syntax))) {
      expect(repo.file(`${DIR}/${image.path.slice(2)}`)).toBeDefined();
    }
    expect((await checkMdx(saved, config.syntax)).ok).toBe(true);
  });

  test("넣은 뒤 본문에서 지운 이미지는 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const { plan, tags } = upload([]);
    const body = `${EDITED}\n${tags[1]}\n`;

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      body,
      images: usedUploads(plan, body),
    });

    expect(result.ok).toBe(true);
    expect(repo.paths().filter((p) => p.startsWith(`${DIR}/`))).toEqual([`${DIR}/3.jpg`, POST]);
    expect(text(repo.file(POST))).not.toContain("./2.png");
  });

  test("준비에 실패한 파일이 섞여도 편집 화면이 고른 제출 대상으로 저장하면 정상 첨부만 커밋된다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const session = createUploadSession({
      doc: parseMdx(SOURCE, config.syntax),
      files: [],
      prepare: async (file: { name: string; content: Uint8Array | null }) =>
        file.content && { extension: file.name.split(".")[1]!, content: file.content, width: 1, height: 1 },
    });
    let tags: string[] = [];
    await session.add(
      [
        { name: "a.png", content: PNG },
        { name: "b.png", content: null },
        { name: "c.jpg", content: JPEG },
      ],
      (added) => (tags = added.images.map(({ name }) => imageTag(IMAGE_COMPONENT, name, ""))),
    );
    const body = `${EDITED}\n${tags.join("\n\n")}\n`;
    const submission = session.submission(body);
    if (!submission.ok) throw new Error(submission.reason);

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      body,
      images: submission.images,
    });

    expect(result.ok).toBe(true);
    expect(repo.paths().filter((p) => p.startsWith(`${DIR}/`))).toEqual([`${DIR}/2.png`, `${DIR}/3.jpg`, POST]);
    expect(text(repo.file(POST))).toContain('<Image src={image1} alt="" />');
  });

  test("대체 텍스트를 넣어 적용한 이미지만 커밋되고, 폼을 취소한 이미지는 저장하지 않는다", async () => {
    const { repo, client } = setup([
      { path: POST, content: SOURCE },
      { path: `${DIR}/1.png`, content: OLD_IMAGE },
    ]);
    const before = repo.head();
    const post = (await readPost(client, REPO, config, POST))!;
    const session = createUploadSession({
      doc: post.doc,
      files: post.images.map((image) => image.name),
      prepare: async (file: { name: string; content: Uint8Array }) => ({
        extension: file.name.split(".")[1]!,
        content: file.content,
        width: 1,
        height: 1,
      }),
    });
    // 편집 화면처럼 이미지마다 폼을 열고, 적용한 것만 대체 텍스트를 담은 태그로 본문에 넣는다.
    let body = EDITED;
    await session.add([{ name: "a.png", content: PNG }], ({ images: [image] }) => {
      body += `\n${imageTag(IMAGE_COMPONENT, image!.name, '진료 "시간" 안내')}\n`;
    });
    await session.add([{ name: "b.jpg", content: JPEG }], () => {});
    const submission = session.submission(body);
    if (!submission.ok) throw new Error(submission.reason);

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: post.sha,
      body,
      images: submission.images,
    });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(repo.paths().filter((p) => p.startsWith(`${DIR}/`))).toEqual([`${DIR}/1.png`, `${DIR}/2.png`, POST]);
    expect(repo.file(`${DIR}/1.png`)).toEqual(OLD_IMAGE);
    const saved = text(repo.file(POST));
    expect(saved).toContain('import image2 from "./2.png";');
    expect(saved).not.toContain("./3.jpg");
    expect(saved).toContain('<Image src={image2} alt="진료 &quot;시간&quot; 안내" />');
  });

  test("이미지를 교체·제거해 본문이 쓰지 않게 된 새 첨부는 커밋하지 않고, 교체한 기존 이미지 파일은 그대로다", async () => {
    const { repo, client } = setup([
      { path: POST, content: SOURCE },
      { path: `${DIR}/1.png`, content: OLD_IMAGE },
    ]);
    const before = repo.head();
    const post = (await readPost(client, REPO, config, POST))!;
    const session = createUploadSession({
      doc: post.doc,
      files: post.images.map((image) => image.name),
      prepare: async (file: { name: string; content: Uint8Array }) => ({
        extension: file.name.split(".")[1]!,
        content: file.content,
        width: 1,
        height: 1,
      }),
    });
    const attach = async (name: string, content: Uint8Array) => {
      let added: AddedUpload | undefined;
      await session.add([{ name, content }], ({ images }) => (added = images[0]));
      return added!;
    };
    const imageOf = (body: string, name: string) => {
      const list = bodyInserts(session.plan.doc, body, config.syntax);
      const found = list.ok && list.items.find((item) => isImageInsert(item) && item.name === name);
      if (!found || !isImageInsert(found)) throw new Error(`이미지 없음: ${name}`);
      return found;
    };
    /** 편집 화면처럼 이미지를 고른 뒤 새 파일을 첨부에 더하고 교체 폼을 적용한다. */
    const replace = async (body: string, name: string, file: string, content: Uint8Array) => {
      const target = bodyImageReplace(session.plan.doc, body, imageOf(body, name));
      const image = await attach(file, content);
      const result = applyBodyInsertForm(
        session.plan.doc,
        body,
        { kind: "replace", ...target, image },
        { text: "교체한 사진", ids: [] },
        config.syntax,
      );
      if (!result.ok) throw new Error(result.reason);
      return result.body;
    };

    // 새로 넣은 2.png를 4.png로 바꾸고, 기존 1.png를 쓰던 자리는 3.jpg로 바꾸고, 새로 넣은 5.png는 지운다.
    const inserted = await attach("a.png", PNG);
    let body = `${EDITED}\n${imageTag(IMAGE_COMPONENT, inserted.name, "새 사진")}\n`;
    body = await replace(body, "image1", "b.jpg", JPEG);
    body = await replace(body, "image2", "c.png", PNG);
    const dropped = await attach("d.png", PNG);
    body = `${body}\n${imageTag(IMAGE_COMPONENT, dropped.name, "지울 사진")}\n`;
    const removed = removeBodyInsert(session.plan.doc, body, imageOf(body, "image5"), config.syntax);
    if (!removed.ok) throw new Error(removed.reason);
    body = removed.body;
    const submission = session.submission(body);
    if (!submission.ok) throw new Error(submission.reason);

    expect(submission.images.map(({ file }) => file)).toEqual(["3.jpg", "4.png"]);
    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: post.sha,
      body,
      images: submission.images,
    });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(repo.paths().filter((p) => p.startsWith(`${DIR}/`))).toEqual([
      `${DIR}/1.png`,
      `${DIR}/3.jpg`,
      `${DIR}/4.png`,
      POST,
    ]);
    expect(repo.file(`${DIR}/1.png`)).toEqual(OLD_IMAGE);
    const saved = text(repo.file(POST));
    expect(saved).toContain('<Image src={image3} alt="교체한 사진" />');
    expect(saved).toContain('<Image src={image4} alt="교체한 사진" />');
    expect(saved).not.toContain("./2.png");
    expect(saved).not.toContain("./5.png");
    expect((await checkMdx(saved, config.syntax)).ok).toBe(true);
  });

  test("본문에서 쓰지 않는 이미지를 보내면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      body: EDITED,
      images: [{ file: "2.png", content: PNG }],
    });

    expect(result).toEqual({ ok: false, reason: "image", file: "2.png", problem: "unused" });
    expect(repo.head()).toBe(before);
  });

  test("글 폴더에 이미 있는 파일 이름이면 덮어쓰지 않고 커밋하지 않는다", async () => {
    const { repo, client } = setup([
      { path: POST, content: SOURCE },
      { path: `${DIR}/2.png`, content: OLD_IMAGE },
    ]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      body: `${EDITED}\n<Image src={image2} alt="" />\n`,
      images: [{ file: "2.png", content: PNG }],
    });

    expect(result).toMatchObject({ ok: false, reason: "image", problem: "name" });
    expect(repo.head()).toBe(before);
    expect(repo.file(`${DIR}/2.png`)).toEqual(OLD_IMAGE);
  });

  test("형식이 다르거나 합계가 상한을 넘으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();
    const body = `${EDITED}\n<Image src={image2} alt="" />\n`;
    const save = (content: Uint8Array) =>
      saveBody(client, REPO, config, {
        path: POST,
        baseSha: blobSha(SOURCE),
        body,
        images: [{ file: "2.png", content }],
      });
    const large = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    large.set(PNG);

    expect(await save(JPEG)).toMatchObject({ reason: "image", problem: "format" });
    expect(await save(large)).toMatchObject({ reason: "image", problem: "size" });
    expect(repo.head()).toBe(before);
  });
});

const fixtures = loadFixtures("yjshd");

describe("yjshd 픽스처 전체", () => {
  test.skipIf(!fixtures)("config 컬렉션의 모든 글을 본문 그대로 저장하면 커밋하지 않는다", async () => {
    const changed: string[] = [];
    let covered = 0;
    for (const fixture of fixtures ?? []) {
      const filePath = `content/${fixture.path}`;
      if (!findCollection(config, filePath)) continue;
      covered++;
      const { repo, client } = setup([{ path: filePath, content: fixture.source }]);
      const before = repo.head();
      const result = await saveBody(client, REPO, config, {
        path: filePath,
        baseSha: blobSha(fixture.source),
        body: bodyOf(fixture.source),
      });
      if (result.ok || result.reason !== "unchanged" || repo.head() !== before) {
        changed.push(`${fixture.path}: ${JSON.stringify(result)}`);
      }
    }
    expect(changed).toEqual([]);
    // 게시판 47 + 강좌 103. save-metadata.test.ts와 같은 범위다.
    expect(covered).toBe(150);
  });

  test.skipIf(!fixtures)(
    "게시판 글의 본문을 고쳐 저장하면 본문 앞 import·metadata는 원본 그대로다",
    async () => {
      const failures: string[] = [];
      for (const fixture of fixtures!.filter((f) => f.path.startsWith("4.게시판/"))) {
        const filePath = `content/${fixture.path}`;
        const { repo, client } = setup([{ path: filePath, content: fixture.source }]);
        const body = bodyOf(fixture.source) + "\n추가한 **문단**\n";
        const result = await saveBody(client, REPO, config, {
          path: filePath,
          baseSha: blobSha(fixture.source),
          body,
        });
        const head = fixture.source.slice(0, fixture.source.length - bodyOf(fixture.source).length);
        if (!result.ok || text(repo.file(filePath)) !== head + body) {
          failures.push(`${fixture.path}: ${JSON.stringify(result)}`);
        }
      }
      expect(failures).toEqual([]);
    },
    60_000,
  );
});
