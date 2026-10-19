// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 업로드 정책만 가져온다.
import { fitImageSize, uploadExtension } from "@/lib/content/upload";

/**
 * 브라우저에서 고른 이미지를 올릴 바이트로 만든다. 긴 변이 상한보다 크면 같은 형식으로 줄인다.
 * 받지 않는 형식이거나 이미지로 읽을 수 없으면 null.
 */
export async function prepareImage(file: File): Promise<{ extension: string; content: Uint8Array } | null> {
  const extension = uploadExtension(file.type);
  if (!extension) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const size = fitImageSize(bitmap.width, bitmap.height);
  if (!size) {
    bitmap.close();
    return { extension, content: new Uint8Array(await file.arrayBuffer()) };
  }

  const canvas = new OffscreenCanvas(size.width, size.height);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const resized = await canvas.convertToBlob({ type: file.type, quality: 0.9 });
  // webp로 인코딩하지 못하는 브라우저는 png로 내보내므로 확장자를 결과 형식에서 다시 정한다.
  const resizedExtension = uploadExtension(resized.type);
  if (!resizedExtension) return null;
  return { extension: resizedExtension, content: new Uint8Array(await resized.arrayBuffer()) };
}
