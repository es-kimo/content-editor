import {
  lookupMetadata,
  parseMdx,
  readMetadata,
  type MetadataResult,
  type MetadataValue,
  type Syntax,
} from "@/lib/mdx-doc";
import { readTrash, STATUS_FIELD, TITLE_FIELD } from "@/lib/metadata-form";

export type PostSummary = {
  title: string;
  /** title을 metadata에서 읽었는지. false면 title은 파일명(slug)이다. */
  titleFromMetadata: boolean;
  status: string | null;
  createdAt: string | null;
  /** 휴지통 글인지. metadata를 읽지 못한 글은 휴지통 표시도 알 수 없어 false다. */
  trashed: boolean;
  /** 휴지통에 옮긴 시각. 휴지통 글이 아니거나 시각이 문자열이 아니면 null. */
  trashedAt: string | null;
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
    trashed: false,
    trashedAt: null,
    problem,
  });

  const doc = parseMdx(source, syntax);
  if (!doc.ok) return fallback(doc.message);
  const metadata = readMetadata(doc);
  if (!metadata) return fallback("metadata export가 없다");
  if (!metadata.editable) return fallback(metadata.reason);

  const title = savedTitle(metadata);
  const trash = readTrash(metadata.value);
  return {
    title: title ?? fallbackTitle,
    titleFromMetadata: title !== null,
    status: stringAt(metadata.value, STATUS_FIELD),
    createdAt: stringAt(metadata.value, "other.createdAt"),
    trashed: trash.trashed,
    trashedAt: trash.trashed ? trash.trashedAt : null,
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

// 에디터 사용자와 두 사이트가 한국에 있어, 서버 시간대와 상관없이 한국 시각으로 보인다.
const KOREA_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 화면에 보일 시각(`YYYY-MM-DD HH:mm`, 한국 시각). @param time epoch 밀리초 */
export function koreaTimeText(time: number): string {
  return KOREA_TIME.format(time);
}

/** 휴지통 목록에 보일 삭제 시각(`YYYY-MM-DD HH:mm`, 한국 시각). 시각이 없거나 읽을 수 없으면 `-`. */
export function trashedAtText(trashedAt: string | null): string {
  const time = trashedAt === null ? NaN : Date.parse(trashedAt);
  return Number.isNaN(time) ? "-" : koreaTimeText(time);
}
