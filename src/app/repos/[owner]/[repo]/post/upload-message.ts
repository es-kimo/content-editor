import { MAX_UPLOAD_BYTES, type UploadProblem } from "@/lib/content/upload";

/** 이미지를 받을 수 없을 때의 안내. 대체 텍스트를 이미지마다 입력하므로 한 번에 하나씩 받는다. */
export const IMAGE_ADD_BLOCKED = {
  many: "이미지는 한 번에 하나씩 넣어 주세요.",
  preparing: "이미지를 준비하고 있어요. 준비가 끝난 뒤 다음 이미지를 넣어 주세요.",
  form: "열려 있는 폼을 먼저 적용하거나 취소해 주세요.",
  unopened: "이미지를 넣을 폼을 열지 못했어요. 저장이 끝난 뒤 이미지를 다시 넣어 주세요.",
};

/** 이미지 검사 실패 안내. 브라우저에서 넣을 때와 서버에서 저장할 때 같은 문구를 쓴다. */
export function uploadMessage(file: string, problem: UploadProblem): string {
  switch (problem) {
    case "format":
      return `${file}: png·jpg·webp 이미지가 아니라서 넣지 않았어요. 이 세 형식 중 하나로 바꿔 다시 넣어 주세요.`;
    case "size":
      return `${file}: 한 번에 저장하는 이미지가 모두 합쳐 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB를 넘어요. 일부를 먼저 저장한 뒤 나머지를 넣어 주세요.`;
    case "name":
    case "unused":
      return `${file}: 이미지를 글에 붙이지 못했어요. 본문을 따로 보관한 뒤 글을 다시 열고 이미지를 다시 넣어 주세요.`;
  }
}
