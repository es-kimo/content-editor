import { describe, expect, test } from "vitest";

import { restorePost, trashPost, type SaveState, type TrashResult } from "@/lib/content";
import { createGitHubClient } from "@/lib/github";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";

import { savedMessage } from "./save-result";
import { trashResultState, type TrashCommand } from "./trash-result";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";
const NOW = new Date("2026-10-20T09:30:15Z");
const config = yjshdConfig();
const POST_HREF = `/repos/${REPO}/post?path=${encodeURIComponent(POST)}`;

const post = (status: string, trashedAt?: string) => `export const metadata = {
  title: '11월 휴진 안내',
  other: { status: "${status}"${trashedAt === undefined ? "" : `, trashedAt: "${trashedAt}"`} },
};

# 11월 휴진 안내
`;

const TRASHED = post("draft", "2026-10-19T00:00:00Z");

/** `source` 글 하나가 있는 레포에서 `baseSha`로 휴지통 이동이나 복구를 한다. */
const run = (command: TrashCommand, source: string, baseSha = blobSha(source)): Promise<TrashResult> => {
  const repo = fakeGitRepo(REPO, "main", [{ path: POST, content: source }]);
  const client = createGitHubClient("ghu_token", repo.fetch);
  const target = { path: POST, baseSha };
  return command === "trash" ? trashPost(client, REPO, config, target, NOW) : restorePost(client, REPO, config, target);
};

const message = (state: SaveState) => (state.status === "error" ? state.message : null);
/** 다시 연 글 화면이 주소에서 읽는 행동으로 보일 성공 문구. */
const savedText = (state: SaveState) =>
  state.status === "saved"
    ? savedMessage(new URL(state.href, "http://localhost").searchParams.get("action") ?? undefined)
    : null;

describe("trashResultState", () => {
  test("휴지통으로 옮기면 그 글 화면을 다시 열고 초안으로 복구할 수 있다고 알린다", async () => {
    const state = trashResultState(await run("trash", post("ready")), "trash", POST_HREF);

    expect(state.status === "saved" && state.href.startsWith(`${POST_HREF}&`)).toBe(true);
    expect(savedText(state)).toBe("휴지통으로 옮겼어요. 휴지통에서 초안으로 복구할 수 있어요.");
  });

  test("복구하면 그 글 화면을 다시 열고 초안이 됐으니 게시하려면 ‘게시’를 누르라고 알린다", async () => {
    const state = trashResultState(await run("restore", TRASHED), "restore", POST_HREF);

    expect(state.status === "saved" && state.href.startsWith(`${POST_HREF}&`)).toBe(true);
    expect(savedText(state)).toBe("초안으로 복구했어요. 게시하려면 ‘게시’를 눌러 주세요.");
  });

  test.each<[TrashCommand, string]>([
    ["trash", post("draft")],
    ["restore", TRASHED],
  ])("%s: 화면을 연 뒤 글이 바뀌었으면 덮어쓰지 않았다고 보고 다시 열어 확인하게 한다", async (command, source) => {
    const state = trashResultState(await run(command, source, blobSha("다른 원문")), command, POST_HREF);

    expect(message(state)).toBe("화면을 연 뒤 다른 곳에서 글이 바뀌었어요. 글을 다시 열어 바뀐 내용을 확인해 주세요.");
  });

  test("이미 휴지통에 있는 글을 다시 옮기면 이미 휴지통에 있다고 알린다", async () => {
    const state = trashResultState(await run("trash", TRASHED), "trash", POST_HREF);

    expect(message(state)).toBe("이미 휴지통에 있는 글이에요. 글을 다시 열어 지금 상태를 확인해 주세요.");
  });

  test("이미 휴지통에서 꺼낸 글을 다시 복구하면 이미 꺼냈다고 알린다", async () => {
    const state = trashResultState(await run("restore", post("draft")), "restore", POST_HREF);

    expect(message(state)).toBe("이미 휴지통에서 꺼낸 글이에요. 글을 다시 열어 지금 상태를 확인해 주세요.");
  });

  test("글이 없어졌으면 글 목록에서 다시 열라고 저장과 같게 안내한다", () => {
    expect(message(trashResultState({ ok: false, reason: "not-found" }, "restore", POST_HREF))).toBe(
      "글을 찾을 수 없어요. 글 목록에서 글을 다시 열어 주세요.",
    );
  });
});
