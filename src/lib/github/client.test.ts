import { describe, expect, test } from "vitest";

import { json, mockFetch } from "@/test/mock-fetch";

import { createGitHubClient, GitHubApiError, isUnauthorized } from "./client";

describe("isUnauthorized", () => {
  test("API가 401로 답하면 다시 로그인해야 하는 오류다", async () => {
    const client = createGitHubClient(
      "bad",
      mockFetch(() => json({ message: "Bad credentials" }, 401)),
    );
    const error = await client.rest("/user").catch((e: unknown) => e);
    expect(isUnauthorized(error)).toBe(true);
  });

  test("401이 아닌 API 오류는 로그인 문제로 보지 않는다", async () => {
    const client = createGitHubClient(
      "t",
      mockFetch(() => json({ message: "Not Found" }, 404)),
    );
    const error = await client.rest("/user").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(isUnauthorized(error)).toBe(false);
  });

  test("HTTP 상태가 없는 오류는 로그인 문제로 보지 않는다", () => {
    expect(isUnauthorized(new GitHubApiError("GitHub GraphQL 실패", null))).toBe(false);
    expect(isUnauthorized(Object.assign(new Error("다른 오류"), { status: 401 }))).toBe(false);
  });
});
