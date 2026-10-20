import {
  lookupMetadata,
  parseMdx,
  readMetadata,
  type MetadataResult,
  type MetadataValue,
  type Syntax,
} from "@/lib/mdx-doc";
import { STATUS_FIELD, TITLE_FIELD } from "@/lib/metadata-form";

export type PostSummary = {
  title: string;
  /** title을 metadata에서 읽었는지. false면 title은 파일명(slug)이다. */
  titleFromMetadata: boolean;
  status: string | null;
  createdAt: string | null;
  /** metadata를 읽지 못한 이유. 읽었으면 null. */
  problem: string | null;
};

/** 저장된 제목이 없는 글을 화면에서 부르는 이름. 파일 이름이나 경로를 제목 자리에 쓰지 않는다. */
export const UNTITLED_POST = "제목 없는 글";

const stringAt = (value: { [key: string]: MetadataValue }, key: string): string | null => {
  const found = lookupMetadata(value, key);
  return found.kind === "found" && typeof found.value === "string" ? found.value : null;
};

/** metadata에 저장된 제목. 폼으로 읽을 수 없거나 제목이 비었으면 null. */
function savedTitle(metadata: MetadataResult | null): string | null {
  if (!metadata?.editable) return null;
  return stringAt(metadata.value, TITLE_FIELD)?.trim() || null;
}

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
  const metadata = readMetadata(doc);
  if (!metadata) return fallback("metadata export가 없다");
  if (!metadata.editable) return fallback(metadata.reason);

  const title = savedTitle(metadata);
  return {
    title: title ?? fallbackTitle,
    titleFromMetadata: title !== null,
    status: stringAt(metadata.value, STATUS_FIELD),
    createdAt: stringAt(metadata.value, "other.createdAt"),
    problem: title ? null : "metadata에 title이 없다",
  };
}

/** 글 화면의 제목. 저장된 제목이 없으면 `UNTITLED_POST`. */
export function postTitle(metadata: MetadataResult | null): string {
  return savedTitle(metadata) ?? UNTITLED_POST;
}

/** 글 목록에 보일 제목. 글 화면과 같은 규칙이라 파일명(slug)으로 대신하지 않는다. */
export function listTitle(summary: Pick<PostSummary, "title" | "titleFromMetadata">): string {
  return summary.titleFromMetadata ? summary.title : UNTITLED_POST;
}
