import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "./fixtures";

describe.each(fixtureSources)("fixtures: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)(`page.mdx ${source.expected}개`, () => {
    expect(fixtures).toHaveLength(source.expected);
  });

  test.skipIf(!fixtures)("모든 글에 metadata export가 있다", () => {
    const missing = fixtures!.filter((f) => !f.source.includes("export const metadata")).map((f) => f.path);
    expect(missing).toEqual([]);
  });
});
