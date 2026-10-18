import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import config from "../../fixtures.config.json";

export type FixtureSource = (typeof config.sources)[number];
export type Fixture = { site: string; path: string; source: string };

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../../fixtures");

export const fixtureSources: FixtureSource[] = config.sources;

/** `pnpm fixtures:sync`로 받아 둔 page.mdx 목록. 받지 않았으면 null. */
export function loadFixtures(site: string): Fixture[] | null {
  const dir = path.join(FIXTURES_DIR, site);
  if (!existsSync(dir)) return null;
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("page.mdx"))
    .sort()
    .map((file) => ({ site, path: file, source: readFileSync(path.join(dir, file), "utf8") }));
}
