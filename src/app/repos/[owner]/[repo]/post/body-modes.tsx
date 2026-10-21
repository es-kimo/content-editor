import { IMAGE_COMPONENT, sourceComponents } from "@/lib/content";
import type { Collection } from "@/lib/editor-config";
import type { MdxDoc, Syntax } from "@/lib/mdx-doc";

import { BodyEditor } from "./body-editor";
import { EditorModeSwitch } from "./editor-mode-switch";
import { SourceEditor } from "./source-editor";

/** 원문을 나눌 수 있는 글의 본문 편집기. 일반 편집과 원문 편집을 오간다. 글 화면과 새 글 화면이 함께 쓴다. */
export function BodyModes({
  collection,
  source,
  doc,
  files,
  keys,
  syntax,
  preview,
}: {
  collection: Collection;
  source: string;
  doc: Extract<MdxDoc, { ok: true }>;
  /** 글 폴더 파일 이름. 새 이미지 이름이 그 번호를 쓰지 않게 한다. */
  files: string[];
  /**
   * 편집기를 다시 열 key. 원문은 파일 전체라 저장마다(sha) 다시 열고,
   * 일반 편집은 저장해도 본문이 그대로면 다시 열지 않도록 본문 원본으로 둔다.
   */
  keys: { source: string; body: string };
  syntax: Syntax;
  preview?: string;
}) {
  // 이미지는 글 분류 설정이 허용한 글에만 넣는다.
  const upload = collection.components.includes(IMAGE_COMPONENT) ? { files } : null;
  return (
    <EditorModeSwitch
      source={
        <SourceEditor
          key={keys.source}
          source={source}
          syntax={syntax}
          components={sourceComponents(collection)}
          upload={upload}
          preview={preview}
        />
      }
      wysiwyg={
        <BodyEditor
          key={keys.body}
          doc={doc}
          body={doc.body}
          syntax={syntax}
          components={collection.components}
          upload={upload}
          preview={preview}
        />
      }
    />
  );
}
