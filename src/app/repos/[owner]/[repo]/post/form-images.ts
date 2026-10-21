import type { UploadImage } from "@/lib/content";

/**
 * 편집 화면이 넣은 이미지. 파일 이름이 `N.ext`인 `image` 파일로 받는다.
 * 서버 액션 파일에 두면 이 함수도 액션으로 공개되므로 따로 둔다.
 */
export async function readImages(data: FormData): Promise<UploadImage[]> {
  const files = data.getAll("image").filter((value): value is File => value instanceof File);
  return Promise.all(
    files.map(async (file) => ({ file: file.name, content: new Uint8Array(await file.arrayBuffer()) })),
  );
}
