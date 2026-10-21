import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { addImageAt, parseMdx, readInserts } from "@/lib/mdx-doc";
import { blogConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha, type FakeFile } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";
import { JPEG, PNG } from "@/test/upload-images";

import { applyInsertForm, isImageInsert } from "./insert-form";
import { saveSource } from "./save-source";
import { IMAGE_COMPONENT, MAX_UPLOAD_BYTES, sourceUploads } from "./upload";
import { createUploadSession, type AddedUpload } from "./upload-session";

const REPO = "es-kimo/site";
const BRANCH = "blog";
const POST = "apps/blog/content/Computer-Science/github-pages/page.mdx";

/** 실제 blog에 넣을 config 예시. 완료 기준을 이 config로 확인한다. */
const config = blogConfig();

const SOURCE = `import { toc } from "./toc";

export const metadata = {
  title: "GitHub Pages의 HTTPS",
  other: { status: "draft" },
};

# GitHub Pages의 HTTPS

<TOC items={toc} />

인증서 설정 없이 HTTPS가 동작한다.
`;

/** import를 하나 더하고, metadata 상태와 본문 문단·수식을 고친 원문. */
const EDITED = `import { toc } from "./toc";
import { Footnote } from "@/components/footnote";

export const metadata = {
  title: "GitHub Pages의 HTTPS",
  other: { status: "ready" },
};

# GitHub Pages의 HTTPS

<TOC items={toc} />

인증서 설정 없이 HTTPS가 동작한다<Footnote id="1" />. 수식 $a^2$도 쓴다.
`;

const setup = (files: FakeFile[]) => {
  const repo = fakeGitRepo(REPO, BRANCH, [...files, { path: "README.md", content: "# site\n" }]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe("saveSource", () => {
  test("blog 글의 import·metadata·본문을 원문으로 고쳐 저장하면 커밋 1개에 고친 원문 그대로 남는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: EDITED });

    expect(result).toEqual({ ok: true, commit: repo.head(BRANCH), parent: before });
    expect(repo.log(BRANCH)).toHaveLength(2);
    expect(repo.log(BRANCH)[0]!.message).toBe("post: GitHub Pages의 HTTPS");
    expect(text(repo.file(POST, BRANCH))).toBe(EDITED);
  });

  test("구간으로 나눌 수 없는 글도 원문으로 고쳐 저장한다", async () => {
    const source = "본문\n\nexport const a = 1;\n";
    const edited = "고친 본문\n\nexport const a = 2;\n";
    const { repo, client } = setup([{ path: POST, content: source }]);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(source), source: edited });

    expect(result.ok).toBe(true);
    expect(text(repo.file(POST, BRANCH))).toBe(edited);
  });

  test("metadata를 폼으로 읽을 수 없는 글도 원문으로 고쳐 저장하고, 커밋 제목에 slug를 쓴다", async () => {
    const source = `const title = "제목";\n\nexport const metadata = { title };\n\n본문\n`;
    const edited = source.replace("본문", "고친 본문");
    const { repo, client } = setup([{ path: POST, content: source }]);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(source), source: edited });

    expect(result.ok).toBe(true);
    expect(text(repo.file(POST, BRANCH))).toBe(edited);
    expect(repo.log(BRANCH)[0]!.message).toBe("post: github-pages");
  });

  test("원문이 원본과 같으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: SOURCE });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head(BRANCH)).toBe(before);
  });

  test("고친 원문이 컴파일되지 않으면 커밋하지 않고 오류 줄을 알려 준다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);
    // 10행 JSX 속성의 식이 끝나지 않았다.
    const broken = SOURCE.replace("<TOC items={toc} />", "<TOC items={toc +} />");

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: broken });

    expect(result).toMatchObject({ ok: false, reason: "compile", error: { line: 10 } });
    expect(repo.head(BRANCH)).toBe(before);
  });

  test("원문 모드를 연 뒤 다른 곳에서 글을 고쳤으면 저장하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    repo.pushElsewhere([{ path: POST, content: SOURCE.replace("동작한다", "다른 곳에서 고쳤다") }], BRANCH);
    const head = repo.head(BRANCH);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: EDITED });

    expect(result).toMatchObject({ ok: false, reason: "changed" });
    expect(repo.head(BRANCH)).toBe(head);
  });

  test("없는 글이면 not-found", async () => {
    const { client } = setup([{ path: POST, content: SOURCE }]);
    const result = await saveSource(client, REPO, config, {
      path: "apps/blog/content/Computer-Science/없는글/page.mdx",
      baseSha: "x",
      source: EDITED,
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("saveSource 이미지", () => {
  const DIR = "apps/blog/content/Computer-Science/github-pages";
  const OLD_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);

  /** 원문 편집처럼 이미지를 준비해 첨부에 더하고, 적용한 것만 선택 위치에 import와 태그로 넣는다. */
  async function editWithImages(folder: string[]) {
    const session = createUploadSession({
      doc: parseMdx(SOURCE, config.syntax),
      files: folder,
      prepare: async (file: { name: string; content: Uint8Array }) => ({
        extension: file.name.split(".")[1]!,
        content: file.content,
        width: 1,
        height: 1,
      }),
      used: sourceUploads,
    });
    let source = SOURCE;
    await session.add([{ name: "a.png", content: PNG }], ({ images: [image] }) => {
      const at = source.indexOf("인증서");
      const added = addImageAt(
        source,
        { from: at, to: at },
        { file: image!.file, component: IMAGE_COMPONENT, alt: "인증서 화면" },
        config.syntax,
      );
      if (!added.ok) throw new Error(added.reason);
      source = added.source;
    });
    // 폼을 취소한 이미지. 원문에 넣지 않는다.
    await session.add([{ name: "b.jpg", content: JPEG }], () => {});
    return { session, source: () => source };
  }

  test("원문에 넣은 이미지는 원문과 함께 커밋 1개에 담기고, 취소한 이미지와 기존 파일은 그대로다", async () => {
    const { repo, client } = setup([
      { path: POST, content: SOURCE },
      { path: `${DIR}/1.png`, content: OLD_IMAGE },
    ]);
    const before = repo.head(BRANCH);
    const { session, source } = await editWithImages(["1.png"]);
    const submission = session.submission(source());
    if (!submission.ok) throw new Error(submission.reason);

    const result = await saveSource(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: source(),
      images: submission.images,
    });

    expect(result).toEqual({ ok: true, commit: repo.head(BRANCH), parent: before });
    expect(repo.log(BRANCH)).toHaveLength(2);
    expect(text(repo.file(POST, BRANCH))).toBe(
      SOURCE.replace('"./toc";\n', '"./toc";\nimport image2 from "./2.png";\n').replace(
        "인증서",
        '<Image src={image2} alt="인증서 화면" />\n\n인증서',
      ),
    );
    expect(repo.file(`${DIR}/2.png`, BRANCH)).toEqual(PNG);
    expect(repo.file(`${DIR}/1.png`, BRANCH)).toEqual(OLD_IMAGE);
    expect(repo.paths(BRANCH).filter((p) => p.startsWith(`${DIR}/`))).toEqual([`${DIR}/1.png`, `${DIR}/2.png`, POST]);
  });

  test("원문에 넣은 새 이미지를 교체하면 쓰지 않게 된 이전 첨부는 커밋하지 않고 기존 파일은 그대로다", async () => {
    const { repo, client } = setup([
      { path: POST, content: SOURCE },
      { path: `${DIR}/1.png`, content: OLD_IMAGE },
    ]);
    const before = repo.head(BRANCH);
    const { session, source } = await editWithImages(["1.png"]);
    const list = readInserts(source(), config.syntax);
    const item = list.ok ? list.items.find(isImageInsert) : undefined;
    if (!item) throw new Error("이미지 없음");
    let added: AddedUpload | undefined;
    await session.add([{ name: "c.png", content: PNG }], ({ images }) => (added = images[0]));
    const replaced = applyInsertForm(
      source(),
      { kind: "replace", item, opened: source(), image: added! },
      { text: item.alt, ids: [] },
      config.syntax,
    );
    if (!replaced.ok) throw new Error(replaced.reason);
    const submission = session.submission(replaced.source);
    if (!submission.ok) throw new Error(submission.reason);

    expect(submission.images.map(({ file }) => file)).toEqual(["3.png"]);
    const result = await saveSource(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: replaced.source,
      images: submission.images,
    });

    expect(result).toEqual({ ok: true, commit: repo.head(BRANCH), parent: before });
    expect(repo.paths(BRANCH).filter((p) => p.startsWith(`${DIR}/`))).toEqual([`${DIR}/1.png`, `${DIR}/3.png`, POST]);
    expect(repo.file(`${DIR}/1.png`, BRANCH)).toEqual(OLD_IMAGE);
    expect(text(repo.file(POST, BRANCH))).toContain('import image3 from "./3.png";');
    expect(text(repo.file(POST, BRANCH))).not.toContain("./2.png");
  });

  test("원문이 가리키지 않는 이미지를 보내면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);

    const result = await saveSource(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: EDITED,
      images: [{ file: "2.png", content: PNG }],
    });

    expect(result).toEqual({ ok: false, reason: "image", file: "2.png", problem: "unused" });
    expect(repo.head(BRANCH)).toBe(before);
  });

  test("글 폴더에 이미 있는 파일 이름이거나 넣을 때 고른 이름이 아니면 덮어쓰지 않고 커밋하지 않는다", async () => {
    const { repo, client } = setup([
      { path: POST, content: SOURCE },
      { path: `${DIR}/2.png`, content: OLD_IMAGE },
    ]);
    const before = repo.head(BRANCH);
    const save = (file: string) =>
      saveSource(client, REPO, config, {
        path: POST,
        baseSha: blobSha(SOURCE),
        source: `import image2 from "./${file}";\n${SOURCE}<Image src={image2} alt="" />\n`,
        images: [{ file, content: PNG }],
      });

    expect(await save("2.png")).toMatchObject({ ok: false, reason: "image", problem: "name" });
    expect(await save("../2.png")).toMatchObject({ ok: false, reason: "image", problem: "name" });
    expect(repo.head(BRANCH)).toBe(before);
    expect(repo.file(`${DIR}/2.png`, BRANCH)).toEqual(OLD_IMAGE);
  });

  test("형식이 다르거나 용량을 넘으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);
    const save = (content: Uint8Array) =>
      saveSource(client, REPO, config, {
        path: POST,
        baseSha: blobSha(SOURCE),
        source: `import image2 from "./2.png";\n${SOURCE}`,
        images: [{ file: "2.png", content }],
      });
    const large = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    large.set(PNG);

    expect(await save(JPEG)).toMatchObject({ ok: false, reason: "image", problem: "format" });
    expect(await save(large)).toMatchObject({ ok: false, reason: "image", problem: "size" });
    expect(repo.head(BRANCH)).toBe(before);
  });
});

const fixtures = loadFixtures("blog");

describe("blog 픽스처 전체", () => {
  test.skipIf(!fixtures)("모든 글을 원문으로 고쳐 저장하면 파일이 고친 원문 그대로다", async () => {
    const failures: string[] = [];
    for (const fixture of fixtures ?? []) {
      const filePath = `apps/blog/content/${fixture.path}`;
      const { repo, client } = setup([{ path: filePath, content: fixture.source }]);
      const edited = `${fixture.source}\n원문 모드에서 더한 **문단**\n`;
      const result = await saveSource(client, REPO, config, {
        path: filePath,
        baseSha: blobSha(fixture.source),
        source: edited,
      });
      if (!result.ok || text(repo.file(filePath, BRANCH)) !== edited) {
        failures.push(`${fixture.path}: ${JSON.stringify(result)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(fixtures).toHaveLength(14);
  });
});
