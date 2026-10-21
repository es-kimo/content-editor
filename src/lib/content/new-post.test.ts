import { describe, expect, test, vi } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { parseMdx, readMetadata } from "@/lib/mdx-doc";
import type { Collection } from "@/lib/editor-config";
import { FIELD_PREFIX, readStatus, REQUIRED_MESSAGE, type PostAction } from "@/lib/metadata-form";
import { blogConfig, testConfig, yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { PNG } from "@/test/upload-images";

import { createPost } from "./create-post";
import { editorModes } from "./editor-modes";
import { formToSource } from "./mode-switch";
import { newPostFromSource, newPostSource, openNewPost, readNewPostForm } from "./new-post";
import { createSaveFlow, newPostActions, newPostRequest, savedAreas, type SaveState } from "./save-flow";

const REPO = "es-kimo/yjshd";
const NOW = new Date("2026-10-21T01:02:03.000Z");
const config = yjshdConfig();
const [board, lecture] = config.collections;
const IMAGE = { file: "1.png", content: PNG };
const BODY = '# 첫 강좌\n\n<Image src={image1} alt="안내문" />\n';

// 글 설정에 제목 필드가 없고 게시 상태만 있는 글 분류.
const untitledConfig = testConfig([
  {
    name: "메모",
    path: "notes/{slug}/page.mdx",
    metadata: { "other.status": { type: "select", options: ["draft", "ready"] } },
    components: [],
  },
]);
const [untitled] = untitledConfig.collections as [Collection];

const metadataOf = (source: string) => {
  const metadata = readMetadata(parseMdx(source, config.syntax));
  if (!metadata?.editable) throw new Error("metadata를 읽을 수 없다");
  return metadata.value;
};

describe("newPostSource", () => {
  test("빈 제목·기본 설정·빈 본문의 초안이고, 원문 편집으로만 열어야 하는 제한이 없다", () => {
    const source = newPostSource(board, config.syntax, NOW);
    const doc = parseMdx(source, config.syntax);

    expect(doc.ok && doc.body).toBe("");
    expect(metadataOf(source).title).toBe("");
    expect(readStatus(metadataOf(source))).toBe("draft");
    expect(editorModes({ collection: board, doc, metadata: readMetadata(doc) })).toEqual({
      initial: board.editor,
      sourceOnly: null,
    });
  });
});

describe("openNewPost", () => {
  test("빈 새 글 원문을 글 폴더 파일 없이 열고, 글 설정 필드의 제목 칸은 비어 있는 필수 칸이다", () => {
    const opened = openNewPost(board, config.syntax, NOW);

    expect(opened.post).toEqual({
      collection: board,
      syntax: config.syntax,
      source: newPostSource(board, config.syntax, NOW),
      files: [],
    });
    expect(opened.doc.body).toBe("");
    expect(opened.fields.find((f) => f.key === "title")).toMatchObject({ initial: "", required: true, locked: null });
  });

  test("원문 편집이 기본인 글 분류도 새 글은 일반 편집으로 연다", () => {
    const blog = blogConfig();
    const [post] = blog.collections as [Collection];

    expect(post.editor).toBe("source");
    expect(openNewPost(post, blog.syntax, NOW).initial).toBe("wysiwyg");
    expect(openNewPost(board, config.syntax, NOW).initial).toBe("wysiwyg");
  });

  test("글 설정에 제목 필드가 없는 글 분류에도 맨 앞에 비어 있는 필수 제목 칸을 둔다", () => {
    const opened = openNewPost(untitled, untitledConfig.syntax, NOW);

    expect(opened.fields.map((f) => f.key)).toEqual(["title"]);
    expect(opened.fields[0]).toMatchObject({ label: "제목", initial: "", required: true, locked: null });
  });
});

describe("readNewPostForm", () => {
  test("글 설정에 제목 필드가 없는 글 분류에서도 제목 칸의 값을 읽어 그대로 새 글을 저장한다", async () => {
    const data = new FormData();
    data.set(FIELD_PREFIX + "title", "첫 글");
    const repo = fakeGitRepo(REPO, "main", []);

    const values = readNewPostForm(untitled, data);
    const created = await createPost(
      createGitHubClient("ghu_token", repo.fetch),
      REPO,
      untitledConfig,
      { collection: untitled.name, action: "save-draft", values, body: "본문\n" },
      NOW,
    );

    expect(values).toEqual({ title: "첫 글" });
    expect(created).toMatchObject({ ok: true, path: "notes/첫 글/page.mdx" });
    expect(metadataOf(new TextDecoder().decode(repo.file("notes/첫 글/page.mdx")))).toMatchObject({ title: "첫 글" });
  });
});

describe("newPostActions", () => {
  test("저장한 적 없는 새 글은 ‘게시’가 주 행동이고 ‘임시저장’이 보조 행동이다", () => {
    expect(newPostActions(board)).toMatchObject({ ok: true, primary: "publish", secondary: ["save-draft"] });
  });

  test("저장한 적 없는 새 글은 ‘삭제’ 대신 ‘작성 취소’를 둔다", () => {
    expect(newPostActions(board)).toMatchObject({ ok: true, remove: "cancel" });
  });

  test("설정에 초안·게시 상태가 없는 글 분류는 행동이 없고 편집 설정을 확인하라고 안내한다", () => {
    const [plain] = testConfig([{ name: "공지", path: "content/{slug}/page.mdx" }]).collections;

    expect(newPostActions(plain!)).toMatchObject({ ok: false, notice: expect.stringContaining("편집 설정을 확인") });
  });
});

describe("newPostRequest", () => {
  test("‘임시저장’과 ‘게시’만 지금 모드의 새 글 저장 요청을 만든다", () => {
    expect(newPostRequest("save-draft", "wysiwyg")).toEqual({ target: "new", action: "save-draft", mode: "wysiwyg" });
    expect(newPostRequest("publish", "source")).toEqual({ target: "new", action: "publish", mode: "source" });
    expect(newPostRequest("update", "wysiwyg")).toBeNull();
    expect(newPostRequest("unpublish", "wysiwyg")).toBeNull();
  });

  test("새 글 저장은 하위 메뉴·제목과 그 모드의 영역을 함께 저장한다", () => {
    expect(savedAreas(newPostRequest("save-draft", "wysiwyg")!)).toEqual([
      "title",
      "submenu",
      "metadata",
      "body",
      "images",
    ]);
    expect(savedAreas(newPostRequest("publish", "source")!)).toEqual(["title", "submenu", "source", "sourceImages"]);
  });
});

describe("새 글 화면의 저장 요청", () => {
  const setup = () => {
    const navigate = vi.fn<(href: string) => void>();
    const flow = createSaveFlow({ navigate });
    const submit = vi.fn(() => new Promise<SaveState>(() => {}));
    return { flow, submit };
  };

  test.each<PostAction>(["save-draft", "publish"])(
    "이미지를 준비하는 동안과 넣기 폼이 열려 있는 동안은 %s 요청도 저장을 시작하지 않는다",
    (action) => {
      const { flow, submit } = setup();
      const request = newPostRequest(action, "wysiwyg")!;
      for (const area of ["title", "submenu", "metadata", "body", "images"] as const) flow.report(area, true);

      flow.prepare("body", true);
      expect(flow.request(request, submit)).toBe(false);
      flow.prepare("body", false);
      flow.openForm("body");
      expect(flow.request(request, submit)).toBe(false);

      expect(submit).not.toHaveBeenCalled();
      expect(flow.getState().phase).toEqual({ kind: "idle" });
      expect(flow.getState().form).toMatchObject({ area: "body", blocked: action });
    },
  );

  test.each<PostAction>(["save-draft", "publish"])("저장 요청은 %s 행동을 눌렀을 때만 한 번 만들어진다", (action) => {
    const { flow, submit } = setup();
    flow.report("title", true);

    expect(flow.request(newPostRequest(action, "wysiwyg")!, submit)).toBe(true);

    expect(submit).toHaveBeenCalledOnce();
    expect(flow.getState().phase).toEqual({ kind: "saving", request: { target: "new", action, mode: "wysiwyg" } });
  });
});

describe("newPostFromSource", () => {
  const { post } = openNewPost(lecture!, config.syntax, NOW);

  test("원문 편집으로 쓴 제목·설정·본문·첨부가 일반 편집 입력으로 이어지고, 그대로 새 메뉴의 첫 글이 된다", async () => {
    const written = formToSource(post, {
      values: { title: "첫 강좌", description: "AI 강좌" },
      body: BODY,
      images: [IMAGE],
    });
    if (!written.ok) throw new Error(written.reason);
    const repo = fakeGitRepo(REPO, "main", []);

    const result = newPostFromSource(lecture!, config.syntax, written.input, new Date("2026-10-22T00:00:00Z"));
    if (!result.ok) throw new Error(result.reason);
    const created = await createPost(
      createGitHubClient("ghu_token", repo.fetch),
      REPO,
      config,
      { collection: lecture!.name, action: "save-draft", ...result.input, submenu: { kind: "new", name: "AI" } },
      NOW,
    );

    expect(result.input).toMatchObject({ values: { title: "첫 강좌", description: "AI 강좌" }, body: BODY });
    expect(result.input.images).toEqual([IMAGE]);
    expect(created).toMatchObject({ ok: true, path: "content/3.강좌/AI/첫 강좌/page.mdx" });
    expect(repo.file("content/3.강좌/AI/첫 강좌/1.png")).toEqual(PNG);
  });

  test("글 설정에 제목 필드가 없는 글 분류에서도 원문 편집으로 쓴 제목으로 새 글을 저장한다", async () => {
    const opened = openNewPost(untitled, untitledConfig.syntax, NOW);
    const written = formToSource(opened.post, { values: { title: "첫 글" }, body: "본문\n", images: [] });
    if (!written.ok) throw new Error(written.reason);
    const repo = fakeGitRepo(REPO, "main", []);

    const result = newPostFromSource(untitled, untitledConfig.syntax, written.input, NOW);
    if (!result.ok) throw new Error(result.reason);
    const created = await createPost(
      createGitHubClient("ghu_token", repo.fetch),
      REPO,
      untitledConfig,
      { collection: untitled.name, action: "save-draft", ...result.input },
      NOW,
    );

    expect(result.input.values).toMatchObject({ title: "첫 글" });
    expect(created).toMatchObject({ ok: true, path: "notes/첫 글/page.mdx" });
  });

  test("원문 편집에서 제목을 비운 새 글은 바꾸기에 실패하지 않고, 저장할 때 제목 필드 오류가 되며 커밋하지 않는다", async () => {
    const blog = blogConfig();
    const [post] = blog.collections as [Collection];
    // 원문 편집으로 열린 새 글 틀에 글 설정의 제목은 비운 채 본문 제목과 Mermaid만 쓴 원문.
    const source = newPostSource(post, blog.syntax, NOW).replace(
      /\n*$/,
      "\n\n# test\n\n<Mermaid chart={`\nflowchart TD\n    A[시작] --> B[끝]\n`} />\n",
    );
    const repo = fakeGitRepo("es-kimo/blog", "blog", []);
    const save = (title: string) => {
      const result = newPostFromSource(
        post,
        blog.syntax,
        { source: source.replace('title: ""', title), images: [] },
        NOW,
      );
      if (!result.ok) throw new Error(result.reason);
      const submenu = { kind: "new" as const, name: "Frontend" };
      const content = { collection: post.name, action: "save-draft" as const, ...result.input, submenu };
      return createPost(createGitHubClient("ghu_token", repo.fetch), "es-kimo/blog", blog, content, NOW);
    };
    const before = repo.log().length;

    expect(await save('title: ""')).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ key: "title", message: REQUIRED_MESSAGE }],
    });
    expect(repo.log()).toHaveLength(before);
    expect(await save('title: "test"')).toMatchObject({ ok: true });
  });

  test("일반 편집이 담을 수 없는 원문은 모드 전환과 같은 이유로 바꾸지 않는다", () => {
    const source = `import x from "./x.js";\n\n${newPostSource(lecture!, config.syntax, NOW)}`;

    expect(newPostFromSource(lecture!, config.syntax, { source, images: [] }, NOW)).toEqual({
      ok: false,
      reason: "lossy",
    });
  });
});
