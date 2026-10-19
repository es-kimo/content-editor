import { parseMdx, parseMetadata, type MetadataValue, type Syntax } from "@/lib/mdx-doc";

export type PostSummary = {
  title: string;
  /** title을 metadata에서 읽었는지. false면 title은 파일명(slug)이다. */
  titleFromMetadata: boolean;
  status: string | null;
  createdAt: string | null;
  /** metadata를 읽지 못한 이유. 읽었으면 null. */
  problem: string | null;
};

const stringAt = (value: { [key: string]: MetadataValue }, ...keys: string[]): string | null => {
  let current: MetadataValue | undefined = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return null;
    current = Object.hasOwn(current, key) ? current[key] : undefined;
  }
  return typeof current === "string" ? current : null;
};

/** 글 원문에서 목록에 보일 값을 읽는다. 읽지 못하면 title은 `fallbackTitle`(파일명)이다. */
export function summarizePost(source: string, syntax: Syntax, fallbackTitle: string): PostSummary {
  const fallback = (problem: string): PostSummary => ({
    title: fallbackTitle,
    titleFromMetadata: false,
    status: null,
    createdAt: null,
    problem,
  });

  const doc = parseMdx(source, syntax);
  if (!doc.ok) return fallback(doc.message);
  const segment = doc.head.find((s) => s.kind === "metadata");
  if (!segment) return fallback("metadata export가 없다");
  const metadata = parseMetadata(segment.text);
  if (!metadata.editable) return fallback(metadata.reason);

  const title = stringAt(metadata.value, "title")?.trim();
  return {
    title: title || fallbackTitle,
    titleFromMetadata: Boolean(title),
    status: stringAt(metadata.value, "other", "status"),
    createdAt: stringAt(metadata.value, "other", "createdAt"),
    problem: title ? null : "metadata에 title이 없다",
  };
}
