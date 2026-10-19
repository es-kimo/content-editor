import { MAX_UPLOAD_BYTES, type UploadProblem } from "@/lib/content/upload";

/** 이미지 검사 실패 안내. 브라우저에서 넣을 때와 서버에서 저장할 때 같은 문구를 쓴다. */
export function uploadMessage(file: string, problem: UploadProblem): string {
  switch (problem) {
    case "format":
      return `${file}: png·jpg·webp 이미지가 아니어서 넣지 않았다. 이 세 형식 중 하나로 바꿔 다시 넣는다.`;
    case "size":
      return `${file}: 한 번에 저장하는 이미지가 모두 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB를 넘는다. 일부를 먼저 저장한 뒤 나머지를 넣는다.`;
    case "name":
    case "unused":
      return `${file}: 이미지를 글에 붙일 수 없다. 본문을 따로 적어 두고 새로고침한 뒤 이미지를 다시 넣는다.`;
  }
}
