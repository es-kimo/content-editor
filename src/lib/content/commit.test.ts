import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { testConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";

import { commitFiles, postCommitMessage, savePost } from "./commit";
import { readPost } from "./read";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";
const OTHER = "content/4.게시판/2.다른글/page.mdx";

const SOURCE = `export const metadata = {\n  title: '11월 휴진 안내',\n};\n\n# 11월 휴진 안내\n`;
const EDITED = `import image1 from "./1.png";\nimport image2 from "./2.png";\n\nexport const metadata = {\n  title: '12월 휴진 안내',\n};\n\n# 12월 휴진 안내\n\n<Image src={image1} alt="" />\n<Image src={image2} alt="" />\n`;

const png1 = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255]);
const png2 = new Uint8Array([137, 80, 78, 71, 3, 4, 5, 254]);

const config = (branch = "main") => testConfig([{ name: "게시판", path: "content/4.게시판/{slug}/page.mdx" }], branch);

const setup = (branch = "main") => {
  const repo = fakeGitRepo(REPO, branch, [
    { path: POST, content: SOURCE },
    { path: OTHER, content: "# 다른 글\n" },
    { path: "README.md", content: "# yjshd\n" },
  ]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const requests = (fetch: ReturnType<typeof setup>["repo"]["fetch"]) =>
  fetch.mock.calls.map(
    ([url, init]) => `${init?.method ?? "GET"} ${decodeURIComponent(new URL(String(url)).pathname)}`,
  );

describe("savePost", () => {
  test("mdx 1개와 이미지 2개를 저장하면 커밋이 정확히 1개 생긴다", async () => {
    const { repo, client } = setup();
    const before = repo.head();

    const result = await savePost(client, REPO, config(), {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: EDITED,
      title: "12월 휴진 안내",
      images: [
        { name: "1.png", content: png1 },
        { name: "2.png", content: png2 },
      ],
    });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    const log = repo.log();
    expect(log).toHaveLength(2);
    expect(log[0].parents).toEqual([before]);
    expect(log[0].message).toBe("post: 12월 휴진 안내");
    // 작성자를 넘기지 않아야 GitHub이 토큰의 사용자(로그인한 사용자)로 채운다.
    expect(log[0].author).toBeNull();

    expect(new TextDecoder().decode(repo.file(POST))).toBe(EDITED);
    expect(repo.file("content/4.게시판/1.휴진/1.png")).toEqual(png1);
    expect(repo.file("content/4.게시판/1.휴진/2.png")).toEqual(png2);
    // base_tree로 만들어 손대지 않은 파일이 그대로 남는다.
    expect(repo.paths()).toEqual([
      "README.md",
      "content/4.게시판/1.휴진/1.png",
      "content/4.게시판/1.휴진/2.png",
      POST,
      OTHER,
    ]);
    expect(new TextDecoder().decode(repo.file(OTHER))).toBe("# 다른 글\n");

    expect(requests(repo.fetch)).toEqual([
      `GET /repos/${REPO}/git/ref/heads/main`,
      `GET /repos/${REPO}/contents/content/4.게시판/1.휴진`,
      `GET /repos/${REPO}/git/commits/${before}`,
      `POST /repos/${REPO}/git/blobs`,
      `POST /repos/${REPO}/git/blobs`,
      `POST /repos/${REPO}/git/blobs`,
      `POST /repos/${REPO}/git/trees`,
      `POST /repos/${REPO}/git/commits`,
      `PATCH /repos/${REPO}/git/refs/heads/main`,
    ]);
    const patch = repo.fetch.mock.calls.at(-1)![1];
    expect(JSON.parse(String(patch?.body))).toEqual({ sha: repo.head(), force: false });
    const tree = repo.fetch.mock.calls.find(([url]) => String(url).endsWith("/git/trees"))![1];
    expect(JSON.parse(String(tree?.body)).base_tree).toEqual(expect.stringMatching(/^[0-9a-f]{40}$/));
  });

  test("다른 곳에서 먼저 고친 글은 저장을 거부하고 아무것도 만들지 않는다", async () => {
    const { repo, client } = setup();
    repo.pushElsewhere([{ path: POST, content: SOURCE + "\nIDE에서 덧붙임\n" }]);
    const head = repo.head();

    const result = await savePost(client, REPO, config(), {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: EDITED,
      title: "12월 휴진 안내",
      images: [{ name: "1.png", content: png1 }],
    });

    expect(result).toEqual({
      ok: false,
      reason: "changed",
      path: POST,
      expected: blobSha(SOURCE),
      actual: blobSha(SOURCE + "\nIDE에서 덧붙임\n"),
    });
    expect(repo.head()).toBe(head);
    expect(repo.file("content/4.게시판/1.휴진/1.png")).toBeUndefined();
    expect(repo.fetch.mock.calls.some(([, init]) => init?.method === "POST" || init?.method === "PATCH")).toBe(false);
  });

  test("다른 곳에서 지운 글도 거부한다", async () => {
    const { repo, client } = setup();
    // 글 폴더가 통째로 사라져 contents가 404를 주는 경우.
    repo.pushElsewhere([{ path: POST, content: null }], "글 삭제");
    const head = repo.head();

    const result = await savePost(client, REPO, config(), {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: EDITED,
      title: "t",
    });

    expect(result).toMatchObject({ ok: false, reason: "changed", actual: null });
    expect(repo.head()).toBe(head);
  });

  test("다른 글만 바뀌었으면 저장하고, 그 변경을 지우지 않는다", async () => {
    const { repo, client } = setup();
    repo.pushElsewhere([{ path: OTHER, content: "# 다른 글 수정\n" }]);
    const head = repo.head();

    const result = await savePost(client, REPO, config(), {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: EDITED,
      title: "12월 휴진 안내",
    });

    expect(result).toMatchObject({ ok: true, parent: head });
    expect(repo.log()).toHaveLength(3);
    expect(new TextDecoder().decode(repo.file(OTHER))).toBe("# 다른 글 수정\n");
    expect(new TextDecoder().decode(repo.file(POST))).toBe(EDITED);
  });

  test("검사 뒤 ref 갱신 전에 브랜치가 앞서 나가면 force 없이 실패한다", async () => {
    const { repo } = setup();
    const client = createGitHubClient("t", async (input, init) => {
      if (init?.method === "PATCH") repo.pushElsewhere([{ path: OTHER, content: "# 끼어든 커밋\n" }]);
      return repo.fetch(input, init);
    });

    const result = await savePost(client, REPO, config(), {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: EDITED,
      title: "12월 휴진 안내",
    });

    expect(result).toEqual({ ok: false, reason: "not-fast-forward" });
    expect(repo.log().map((c) => c.message)).toEqual(["다른 곳에서 고침", "init"]);
    expect(new TextDecoder().decode(repo.file(POST))).toBe(SOURCE);
    expect(new TextDecoder().decode(repo.file(OTHER))).toBe("# 끼어든 커밋\n");
  });

  test("readPost로 연 글을 그 sha로 저장한다", async () => {
    const { repo, client } = setup();
    const post = await readPost(client, REPO, config(), POST);

    const result = await savePost(client, REPO, config(), {
      path: post!.path,
      baseSha: post!.sha,
      source: post!.source.replace("11월", "12월"),
      title: "12월",
    });

    expect(result.ok).toBe(true);
    expect(repo.log()).toHaveLength(2);
  });

  test("새 글(baseSha null)은 파일이 없을 때만 만든다", async () => {
    const { repo, client } = setup();
    const path = "content/4.게시판/3.새글/page.mdx";
    const input = { path, baseSha: null, source: "# 새 글\n", title: "새 글" };

    expect(await savePost(client, REPO, config(), input)).toMatchObject({ ok: true });
    expect(new TextDecoder().decode(repo.file(path))).toBe("# 새 글\n");

    expect(await savePost(client, REPO, config(), input)).toEqual({
      ok: false,
      reason: "changed",
      path,
      expected: null,
      actual: blobSha("# 새 글\n"),
    });
    expect(repo.log()).toHaveLength(2);
  });

  test("새 글은 글 파일이 없어도 폴더가 이미 있으면 만들지 않는다", async () => {
    const { repo, client } = setup();
    repo.pushElsewhere([{ path: "content/4.게시판/3.새글/1.png", content: png1 }]);
    const path = "content/4.게시판/3.새글/page.mdx";

    const result = await savePost(client, REPO, config(), { path, baseSha: null, source: "# 새 글\n", title: "새 글" });

    expect(result).toMatchObject({ ok: false, reason: "changed", path: "content/4.게시판/3.새글", expected: null });
    expect(repo.file(path)).toBeUndefined();
    expect(repo.log()).toHaveLength(2);
  });

  test("config의 branch에 커밋한다", async () => {
    const { repo, client } = setup("blog");
    const result = await savePost(client, REPO, config("blog"), {
      path: POST,
      baseSha: blobSha(SOURCE),
      source: EDITED,
      title: "a",
    });
    expect(result.ok).toBe(true);
    expect(repo.log("blog")).toHaveLength(2);
    expect(requests(repo.fetch).at(-1)).toBe(`PATCH /repos/${REPO}/git/refs/heads/blog`);
  });

  test("컬렉션 밖 경로나 글 폴더 밖 이미지 이름은 API를 부르기 전에 막는다", async () => {
    const { repo, client } = setup();
    const input = { path: POST, baseSha: blobSha(SOURCE), source: EDITED, title: "a" };

    await expect(savePost(client, REPO, config(), { ...input, path: "content/1.소개/a/page.mdx" })).rejects.toThrow(
      "컬렉션",
    );
    for (const name of ["../1.png", "sub/1.png", "notes.txt", ".png"]) {
      await expect(savePost(client, REPO, config(), { ...input, images: [{ name, content: png1 }] })).rejects.toThrow(
        "이미지 이름",
      );
    }
    expect(repo.fetch).not.toHaveBeenCalled();
  });

  test("422가 아닌 실패는 던진다", async () => {
    const client = createGitHubClient("t", async () => Response.json({ message: "Server Error" }, { status: 502 }));
    await expect(
      savePost(client, REPO, config(), { path: POST, baseSha: blobSha(SOURCE), source: EDITED, title: "a" }),
    ).rejects.toMatchObject({ name: "GitHubApiError", status: 502 });
  });

  const failingPatch = (status: number, message: string, moveBranch = false) => {
    const { repo } = setup();
    const client = createGitHubClient("t", async (input, init) => {
      if (init?.method !== "PATCH") return repo.fetch(input, init);
      if (moveBranch) repo.pushElsewhere([{ path: OTHER, content: "# 끼어든 커밋\n" }]);
      return Response.json({ message }, { status });
    });
    return { repo, client };
  };
  const input = { path: POST, baseSha: blobSha(SOURCE), source: EDITED, title: "a" };

  test("ref 갱신이 422가 아닌 이유로 실패하면 브랜치가 움직였어도 그 오류를 던진다", async () => {
    const { repo, client } = failingPatch(502, "Server Error", true);
    await expect(savePost(client, REPO, config(), input)).rejects.toMatchObject({
      name: "GitHubApiError",
      status: 502,
    });
    expect(repo.log().map((c) => c.message)).toEqual(["다른 곳에서 고침", "init"]);
  });

  test("ref 갱신이 422여도 브랜치 끝이 그대로면(보호 브랜치 등) not-fast-forward로 감추지 않고 던진다", async () => {
    const { repo, client } = failingPatch(422, "Protected branch update failed for refs/heads/main.");
    const head = repo.head();
    await expect(savePost(client, REPO, config(), input)).rejects.toMatchObject({
      name: "GitHubApiError",
      status: 422,
      message: expect.stringContaining("git/refs/heads/main 실패: HTTP 422"),
    });
    expect(repo.head()).toBe(head);
  });

  test("ref 갱신 중 브랜치가 사라져 422가 오면 원래 오류를 던진다", async () => {
    const { repo } = setup();
    const client = createGitHubClient("t", async (url, init) => {
      if (init?.method === "PATCH") {
        // 브랜치를 지운 것처럼 이후 ref 조회는 404, PATCH는 GitHub처럼 422를 준다.
        return Response.json({ message: "Reference does not exist" }, { status: 422 });
      }
      if (String(url).includes("/git/ref/") && repo.fetch.mock.calls.some(([, i]) => i?.method === "POST")) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      return repo.fetch(url, init);
    });
    await expect(savePost(client, REPO, config(), input)).rejects.toMatchObject({
      name: "GitHubApiError",
      status: 422,
      message: expect.stringContaining("git/refs/heads/main 실패: HTTP 422"),
    });
  });
});

describe("commitFiles", () => {
  test("파일이 없으면 커밋하지 않는다", async () => {
    const { repo, client } = setup();
    await expect(commitFiles(client, REPO, { branch: "main", message: "m", files: [], expected: [] })).rejects.toThrow(
      "파일이 없다",
    );
    expect(repo.fetch).not.toHaveBeenCalled();
  });
});

describe("postCommitMessage", () => {
  test.each([
    ["11월 휴진 안내", "post: 11월 휴진 안내"],
    ["  앞뒤 공백  ", "post: 앞뒤 공백"],
    ["두\n줄", "post: 두 줄"],
  ])("%j → %j", (title, expected) => {
    expect(postCommitMessage(title)).toBe(expected);
  });
});
