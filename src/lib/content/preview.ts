import { sniffFormat } from "./upload";

/** 미리보기로 보낼, 편집 화면에서 넣은 이미지. `name`은 본문의 `src={변수}`에 쓰는 import 변수명이다. */
export type PreviewUpload = { name: string; content: Uint8Array; width: number; height: number };

/** 에디터가 사이트 `/preview` iframe에 보내는 메시지 (PRD 5.5). */
export type PreviewMessage = {
  type: "preview";
  /** 파일 전체 원문. import는 사이트가 지운다. */
  source: string;
  images: { [name: string]: { blob: Blob; width: number; height: number } };
};

/**
 * 사이트 미리보기에 보낼 메시지를 만든다.
 * 에디터의 `blob:` 주소는 다른 origin에서 열리지 않으므로 주소가 아니라 Blob을 담는다.
 */
export function previewMessage(source: string, uploads: PreviewUpload[]): PreviewMessage {
  const images: PreviewMessage["images"] = {};
  for (const { name, content, width, height } of uploads) {
    images[name] = { blob: new Blob([new Uint8Array(content)], { type: sniffFormat(content) ?? "" }), width, height };
  }
  return { type: "preview", source, images };
}

/** 미리보기 페이지의 origin. 메시지를 보낼 때 targetOrigin으로 쓴다. 주소가 아니면 null. */
export function previewOrigin(preview: string): string | null {
  try {
    const { origin } = new URL(preview);
    // http·https가 아닌 주소는 origin이 "null"이라 어떤 메시지와도 맞으면 안 된다.
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** 받은 메시지를 미리보기 페이지가 보낸 것으로 믿을지. 호스트·포트·프로토콜이 모두 같아야 한다. */
export function trustsPreviewMessage(preview: string, origin: string): boolean {
  const expected = previewOrigin(preview);
  return expected !== null && expected === origin;
}
