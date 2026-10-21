// 글 화면(서버)과 모드 전환(브라우저)이 함께 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { Collection } from "@/lib/editor-config";
import type { MdxDoc, MetadataResult } from "@/lib/mdx-doc";

export type EditorMode = Collection["editor"];

export type EditorModes =
  | { initial: EditorMode; sourceOnly: null }
  /** `doc`: 구간으로 나눌 수 없는 글. `metadata`: metadata를 폼으로 읽을 수 없는 글 (`editable: false`). */
  | { initial: "source"; sourceOnly: { reason: "doc" | "metadata"; message: string } };

/**
 * 글 화면에서 처음 열 본문 편집 모드와, 원문 모드만 쓸 수 있는 글인지.
 * metadata를 폼으로 읽을 수 없는 글은 WYSIWYG로 본문을 저장할 수는 있어도 metadata를 고칠 곳이 원문뿐이라 원문 모드로만 연다.
 * 원문에서 일반 편집으로 바꿀 때도 이 판정으로 막아, 처음 열 때 막히는 원문이 전환으로 열리지 않게 한다.
 */
export function editorModes(post: {
  collection: Collection;
  doc: MdxDoc;
  metadata: MetadataResult | null;
}): EditorModes {
  if (!post.doc.ok) return { initial: "source", sourceOnly: { reason: "doc", message: post.doc.message } };
  if (post.metadata && !post.metadata.editable) {
    return { initial: "source", sourceOnly: { reason: "metadata", message: post.metadata.reason } };
  }
  return { initial: post.collection.editor, sourceOnly: null };
}
