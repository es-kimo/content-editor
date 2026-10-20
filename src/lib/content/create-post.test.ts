import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { parseMdx, readMetadata } from "@/lib/mdx-doc";
import { readStatus } from "@/lib/metadata-form";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { fakeGitHub, type FakeFile } from "@/test/fake-github";
import { PNG } from "@/test/upload-images";

import { createPost, listSubmenus, type CreatePostInput } from "./create-post";
import { listPosts } from "./posts";
import { readPost } from "./read";

const REPO = "es-kimo/yjshd";
const NOW = new Date("2026-10-19T03:04:05.678Z");
/** 실제 yjshd에 넣을 config 예시. 상태 선택지가 ["ready", "draft"] 순서다. */
const config = yjshdConfig();
const [board, lecture] = config.collections;

const EXISTING = "content/4.게시판/10월 휴진 안내/page.mdx";
const EXISTING_SOURCE = `export const metadata = { title: "10월 휴진 안내" };\n\n# 10월 휴진 안내\n`;
const LECTURE = "content/3.강좌/2.콩팥질환 정보/우울해요/page.mdx";

const setup = (files: FakeFile[] = []) => {
  const repo = fakeGitRepo(REPO, "main", [
    { path: EXISTING, content: EXISTING_SOURCE },
    { path: LECTURE, content: `export const metadata = { title: "우울해요" };\n\n# 우울해요\n` },
    ...files,
  ]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);

const metadataOf = (source: string | undefined) => {
  const metadata = readMetadata(parseMdx(source ?? "", config.syntax));
  if (!metadata?.editable) throw new Error("metadata를 읽을 수 없다");
  return metadata.value;
};

const bodyOf = (source: string | undefined) => {
  const doc = parseMdx(source ?? "", config.syntax);
  if (!doc.ok) throw new Error(doc.message);
  return doc.body;
};

const BODY = '# 11월 휴진 안내\n\n휴진을 알려 드립니다.\n\n<Image src={image1} alt="안내문" />\n';

/** 게시판에 제목만 넣어 임시저장하는 새 글. 다른 값은 덮어써서 쓴다. */
const draft = (title: string, rest: Partial<CreatePostInput> = {}): CreatePostInput => ({
  collection: "게시판",
  action: "save-draft",
  values: { title },
  body: "",
  ...rest,
});

/** 강좌에 새 하위 메뉴를 만들며 쓰는 첫 글. */
const inNewMenu = (name: string, rest: Partial<CreatePostInput> = {}): CreatePostInput =>
  draft("AI에게 물어봐도 될까요", { collection: "강좌", submenu: { kind: "new", name }, ...rest });

describe("createPost", () => {
  test("새 글을 임시저장하면 제목·설정·본문·이미지가 커밋 1개에 들어가고 상태는 draft다", async () => {
    const { repo, client } = setup();
    const before = repo.head();

    const result = await createPost(
      client,
      REPO,
      config,
      draft("11월 휴진 안내", {
        values: { title: "11월 휴진 안내", description: "11월 휴진 일정", keywords: "휴진\n11월" },
        body: BODY,
        images: [{ file: "1.png", content: PNG }],
      }),
      NOW,
    );

    const path = "content/4.게시판/11월 휴진 안내/page.mdx";
    expect(result).toEqual({ ok: true, path, commit: repo.head() });
    expect(repo.log()).toHaveLength(2);
    expect(repo.log()[0]).toMatchObject({ parents: [before], message: "post: 11월 휴진 안내" });
    const metadata = metadataOf(text(repo.file(path)));
    expect(metadata).toMatchObject({
      title: "11월 휴진 안내",
      description: "11월 휴진 일정",
      keywords: ["휴진", "11월"],
    });
    expect(readStatus(metadata)).toBe("draft");
    expect(bodyOf(text(repo.file(path)))).toBe(BODY);
    expect(text(repo.file(path))).toContain(`import image1 from "./1.png";`);
    expect(repo.file("content/4.게시판/11월 휴진 안내/1.png")).toEqual(PNG);
  });

  test("처음부터 게시로 저장하면 같은 커밋 1개에 상태가 ready다", async () => {
    const { repo, client } = setup();

    const result = await createPost(
      client,
      REPO,
      config,
      draft("11월 휴진 안내", { action: "publish", body: BODY, images: [{ file: "1.png", content: PNG }] }),
      NOW,
    );

    expect(result).toMatchObject({ ok: true });
    expect(repo.log()).toHaveLength(2);
    expect(readStatus(metadataOf(text(repo.file("content/4.게시판/11월 휴진 안내/page.mdx"))))).toBe("ready");
    expect(repo.file("content/4.게시판/11월 휴진 안내/1.png")).toEqual(PNG);
  });

  test("폼에 적힌 상태는 따르지 않고 행동이 정한다", async () => {
    const { repo, client } = setup();

    await createPost(
      client,
      REPO,
      config,
      draft("11월 휴진 안내", { values: { title: "11월 휴진 안내", "other.status": "ready" } }),
      NOW,
    );

    expect(readStatus(metadataOf(text(repo.file("content/4.게시판/11월 휴진 안내/page.mdx"))))).toBe("draft");
  });

  test("임시저장은 제목만 있어도 저장하고, 게시는 이미지만 있는 본문도 받는다", async () => {
    const { repo, client } = setup();

    const titleOnly = await createPost(client, REPO, config, draft("11월 휴진 안내"), NOW);
    const imageOnly = await createPost(
      client,
      REPO,
      config,
      draft("12월 휴진 안내", {
        action: "publish",
        body: '<Image src={image1} alt="" />\n',
        images: [{ file: "1.png", content: PNG }],
      }),
      NOW,
    );

    expect(titleOnly).toMatchObject({ ok: true });
    expect(imageOnly).toMatchObject({ ok: true });
    expect(repo.log()).toHaveLength(3);
  });

  test("만든 글은 글 목록에 나타나고 편집 화면에서 metadata 폼으로 열린다", async () => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, draft("11월 휴진 안내"), NOW);

    const path = "content/4.게시판/11월 휴진 안내/page.mdx";
    const files = repo.paths().map((p) => ({ path: p, content: text(repo.file(p))! }));
    const listed = await listPosts(
      createGitHubClient("ghu_token", fakeGitHub(REPO, "main", files)),
      REPO,
      config,
      board!,
    );
    expect(listed.find((post) => post.path === path)).toMatchObject({
      title: "11월 휴진 안내",
      status: "draft",
      createdAt: "2026-10-19T03:04:05Z",
      problem: null,
    });
    const post = await readPost(client, REPO, config, result.ok ? result.path : "");
    expect(post?.doc.ok).toBe(true);
    expect(post?.metadata).toMatchObject({ editable: true, value: { title: "11월 휴진 안내", description: "" } });
  });

  test("제목의 경로에 쓸 수 없는 문자는 폴더 이름에서만 바꾸고 metadata 제목은 그대로 둔다", async () => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, draft("휴진이 있나요?"), NOW);

    expect(result).toMatchObject({ ok: true, path: "content/4.게시판/휴진이 있나요_/page.mdx" });
    expect(metadataOf(text(repo.file("content/4.게시판/휴진이 있나요_/page.mdx"))).title).toBe("휴진이 있나요?");
  });

  test("빈 제목은 title 오류이고 커밋하지 않는다", async () => {
    for (const action of ["save-draft", "publish"] as const) {
      const { repo, client } = setup();

      const result = await createPost(
        client,
        REPO,
        config,
        draft("  ", { action, body: "휴진을 알려 드립니다.\n" }),
        NOW,
      );

      expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [{ key: "title" }] });
      expect(repo.log()).toHaveLength(1);
    }
  });

  test("게시할 때 본문이 비어 있으면 본문 오류이고 커밋하지 않는다", async () => {
    const { repo, client } = setup();

    const result = await createPost(
      client,
      REPO,
      config,
      draft("11월 휴진 안내", { action: "publish", body: " \n" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [{ key: "body" }] });
    expect(repo.log()).toHaveLength(1);
  });

  test("본문이 컴파일되지 않으면 커밋하지 않는다", async () => {
    const { repo, client } = setup();

    const result = await createPost(
      client,
      REPO,
      config,
      draft("11월 휴진 안내", { body: "<div>\n\n닫지 않음\n" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, reason: "compile" });
    expect(repo.log()).toHaveLength(1);
  });

  test("형식이 맞지 않거나 본문이 쓰지 않는 이미지는 커밋하지 않는다", async () => {
    for (const input of [
      draft("11월 휴진 안내", { body: BODY, images: [{ file: "1.png", content: new Uint8Array([1, 2]) }] }),
      draft("11월 휴진 안내", { body: "본문\n", images: [{ file: "1.png", content: PNG }] }),
    ]) {
      const { repo, client } = setup();

      expect(await createPost(client, REPO, config, input, NOW)).toMatchObject({ ok: false, reason: "image" });
      expect(repo.log()).toHaveLength(1);
    }
  });

  test("설정이 초안·게시 상태를 다루지 못하면 상태를 넘겨짚지 않고 커밋하지 않는다", async () => {
    const noStatus = { ...config, collections: [{ ...board!, metadata: { title: board!.metadata.title! } }] };
    const { repo, client } = setup();

    const result = await createPost(client, REPO, noStatus, draft("11월 휴진 안내"), NOW);

    expect(result).toEqual({ ok: false, reason: "status-field" });
    expect(repo.log()).toHaveLength(1);
  });

  test("하위 메뉴가 있는 컬렉션은 고른 기존 하위 메뉴 폴더 안에 만든다", async () => {
    const { repo, client } = setup();

    const result = await createPost(
      client,
      REPO,
      config,
      draft("불면증이 심해요", { collection: "강좌", submenu: { kind: "existing", name: "2.콩팥질환 정보" } }),
      NOW,
    );

    expect(result).toMatchObject({ ok: true, path: "content/3.강좌/2.콩팥질환 정보/불면증이 심해요/page.mdx" });
    expect(repo.file("content/3.강좌/2.콩팥질환 정보/불면증이 심해요/page.mdx")).toBeDefined();
  });

  test("하위 메뉴 뒤에 고정 단계가 있는 경로 패턴이면 그 단계 아래에 만든다", async () => {
    const custom = {
      ...config,
      collections: [{ ...lecture!, path: "content/3.강좌/{submenu}/posts/{slug}/page.mdx" }],
    };
    const { repo, client } = setup([{ path: "content/3.강좌/공지/posts/첫 글/page.mdx", content: "# 첫 글\n" }]);

    const existing = await createPost(
      client,
      REPO,
      custom,
      draft("새 글", { collection: "강좌", submenu: { kind: "existing", name: "공지" } }),
      NOW,
    );
    const created = await createPost(client, REPO, custom, inNewMenu("AI"), NOW);

    expect(existing).toMatchObject({ ok: true, path: "content/3.강좌/공지/posts/새 글/page.mdx" });
    expect(created).toMatchObject({ ok: true, path: "content/3.강좌/AI/posts/AI에게 물어봐도 될까요/page.mdx" });
    expect(repo.file("content/3.강좌/AI/posts/AI에게 물어봐도 될까요/page.mdx")).toBeDefined();
  });

  test("같은 폴더가 이미 있으면 만들지 않고 기존 글을 바꾸지 않는다", async () => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, draft(" 10월  휴진 안내 ", { body: "덮어쓰기\n" }), NOW);

    expect(result).toEqual({ ok: false, reason: "exists", path: EXISTING });
    expect(repo.log()).toHaveLength(1);
    expect(text(repo.file(EXISTING))).toBe(EXISTING_SOURCE);
  });

  test("글 파일 없이 이미지만 있는 폴더도 이미 있는 것으로 보고 막는다", async () => {
    const { repo, client } = setup([{ path: "content/4.게시판/11월 휴진 안내/1.png", content: new Uint8Array([1]) }]);

    const result = await createPost(client, REPO, config, draft("11월 휴진 안내"), NOW);

    expect(result).toMatchObject({ ok: false, reason: "exists" });
    expect(repo.log()).toHaveLength(1);
  });

  test.each([
    [draft("제목", { collection: "없는 컬렉션" }), "collection"],
    [draft("???"), "title"],
    [draft("제목", { collection: "강좌" }), "submenu"],
    [draft("제목", { collection: "강좌", submenu: { kind: "existing", name: "" } }), "submenu"],
    [draft("제목", { collection: "강좌", submenu: { kind: "existing", name: "9.새 메뉴" } }), "submenu"],
  ] as const)("입력이 잘못되면 커밋하지 않고 그 필드를 알린다: %j", async (input, key) => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, input, NOW);

    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [{ key }] });
    expect(repo.log()).toHaveLength(1);
  });
});

describe("createPost: 새 하위 메뉴", () => {
  test("강좌에 새 하위 메뉴 AI로 첫 글을 임시저장하면 메뉴 폴더와 글이 커밋 1개로 생긴다", async () => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, inNewMenu(" AI "), NOW);

    const path = "content/3.강좌/AI/AI에게 물어봐도 될까요/page.mdx";
    expect(result).toEqual({ ok: true, path, commit: repo.head() });
    expect(repo.log()).toHaveLength(2);
    expect(readStatus(metadataOf(text(repo.file(path))))).toBe("draft");
    expect(await listSubmenus(client, REPO, config, lecture!)).toEqual(["2.콩팥질환 정보", "AI"]);
  });

  test("기존 메뉴와 앞뒤 공백이나 유니코드 정규화만 다른 이름은 커밋 없이 submenu 오류로 기존 메뉴를 고르게 한다", async () => {
    for (const name of ["2.콩팥질환 정보", "  2.콩팥질환 정보 ", "2.콩팥질환 정보".normalize("NFD")]) {
      const { repo, client } = setup();

      const result = await createPost(client, REPO, config, inNewMenu(name), NOW);

      expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [{ key: "submenu" }] });
      expect(result.ok === false && result.reason === "invalid" && result.errors[0]!.message).toContain(
        "‘2.콩팥질환 정보’ 하위 메뉴가 이미 있어요",
      );
      expect(repo.log()).toHaveLength(1);
    }
  });

  test.each(["", "  ", ".", "..", "a/b", "AI\u0007", "AI\n기초", "AI?", "가".repeat(67)])(
    "쓸 수 없는 이름은 다른 이름으로 바꿔 저장하지 않고 submenu 오류다: %j",
    async (name) => {
      const { repo, client } = setup();
      const paths = repo.paths();

      const result = await createPost(client, REPO, config, inNewMenu(name), NOW);

      expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [{ key: "submenu" }] });
      expect(repo.log()).toHaveLength(1);
      expect(repo.paths()).toEqual(paths);
    },
  );

  test("첫 글이 컴파일되지 않으면 커밋하지 않아 메뉴 폴더도 생기지 않는다", async () => {
    const { repo, client } = setup();
    const before = repo.head();

    const result = await createPost(client, REPO, config, inNewMenu("AI", { body: "<div>\n\n닫지 않음\n" }), NOW);

    expect(result).toMatchObject({ ok: false, reason: "compile" });
    expect(repo.head()).toBe(before);
    expect(repo.paths().filter((p) => p.startsWith("content/3.강좌/AI/"))).toEqual([]);
  });

  test("메뉴 자리에 글이 아닌 폴더나 파일이 이미 있으면 그 안에 만들지 않고 submenu 오류다", async () => {
    for (const existing of [
      { path: "content/3.강좌/AI/AI에게 물어봐도 될까요/1.png", content: PNG },
      { path: "content/3.강좌/AI/메모.txt", content: "메모\n" },
      { path: "content/3.강좌/AI", content: "파일\n" },
    ]) {
      const { repo, client } = setup([existing]);
      const before = repo.head();

      const result = await createPost(client, REPO, config, inNewMenu("AI"), NOW);

      expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [{ key: "submenu" }] });
      expect(repo.head()).toBe(before);
      expect(repo.file(existing.path)).toEqual(
        typeof existing.content === "string" ? new TextEncoder().encode(existing.content) : existing.content,
      );
    }
  });

  test("검사 뒤 ref 갱신 전에 브랜치가 앞서 나가면 not-fast-forward이고 메뉴 폴더는 생기지 않는다", async () => {
    const { repo } = setup();
    let elsewhere = "";
    const client = createGitHubClient("t", async (input, init) => {
      if (init?.method === "PATCH") {
        repo.pushElsewhere([{ path: "README.md", content: "# 끼어든 커밋\n" }]);
        elsewhere = repo.head();
      }
      return repo.fetch(input, init);
    });

    const result = await createPost(client, REPO, config, inNewMenu("AI"), NOW);

    expect(result).toEqual({ ok: false, reason: "not-fast-forward" });
    expect(repo.head()).toBe(elsewhere);
    expect(repo.paths().filter((p) => p.startsWith("content/3.강좌/AI"))).toEqual([]);
  });
});

describe("listSubmenus", () => {
  test("컬렉션에 글이 있는 하위 메뉴를 겹치지 않게 이름순으로 돌려준다", async () => {
    const { client } = setup([
      { path: "content/3.강좌/3.혈액투석 1,2,3/태풍/page.mdx", content: "# 태풍\n" },
      { path: "content/3.강좌/2.콩팥질환 정보/우울해요/1.png", content: new Uint8Array([1]) },
    ]);

    expect(await listSubmenus(client, REPO, config, lecture!)).toEqual(["2.콩팥질환 정보", "3.혈액투석 1,2,3"]);
  });
});
