import { describe, expect, test } from "vitest";

import { parseMdx, printMdx, setBody } from "@/lib/mdx-doc";

import { previewMessage, previewOrigin, trustsPreviewMessage, uploadPreviewMessage } from "./preview";
import { addUpload } from "./upload";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3, 4]);

const SOURCE =
  'import image1 from "./1.png";\n\nexport const metadata = { title: "글" };\n\n<Image src={image1} alt="" />\n';

describe("previewMessage", () => {
  test("넣은 이미지를 import 변수명을 키로 바이트와 크기를 담고, 원문은 그대로 보낸다", async () => {
    const message = previewMessage(SOURCE, [
      { name: "image1", content: PNG, width: 640, height: 480 },
      { name: "image2", content: JPEG, width: 10, height: 20 },
    ]);

    expect(message.type).toBe("preview");
    expect(message.source).toBe(SOURCE);
    expect(Object.keys(message.images)).toEqual(["image1", "image2"]);
    expect(message.images.image1).toMatchObject({ width: 640, height: 480 });
    expect(message.images.image2).toMatchObject({ width: 10, height: 20 });
    expect(new Uint8Array(await message.images.image1.blob.arrayBuffer())).toEqual(PNG);
    expect(new Uint8Array(await message.images.image2.blob.arrayBuffer())).toEqual(JPEG);
  });

  test("Blob에 이미지 형식을 붙여 사이트가 그대로 그릴 수 있게 한다", () => {
    const message = previewMessage(SOURCE, [{ name: "image1", content: PNG, width: 1, height: 1 }]);
    expect(message.images.image1.blob.type).toBe("image/png");
  });

  test("넣은 이미지가 없으면 images가 비어 있다", () => {
    expect(previewMessage(SOURCE, []).images).toEqual({});
  });
});

describe("uploadPreviewMessage", () => {
  test("고친 본문에 넣은 이미지의 import를 붙인 파일 전체와, 넣은 이미지만 담는다", () => {
    const opened = parseMdx(SOURCE);
    const added = addUpload({ doc: opened, images: [] }, { extension: "jpg", content: JPEG }, ["1.png"]);
    if (!added.ok) throw new Error(added.problem);
    const body = `고친 본문\n\n${added.tag}\n`;

    const message = uploadPreviewMessage(added.plan, body, new Map([[added.file, { width: 10, height: 20 }]]));

    expect(message.source).toBe(printMdx(setBody(added.plan.doc, body)));
    expect(message.source).toMatch(/^import image1 from "\.\/1\.png";\nimport image2 from "\.\/2\.jpg";/);
    expect(message.source.endsWith(body)).toBe(true);
    // 레포에 이미 있는 이미지(image1)는 이 이슈 범위 밖이라 보내지 않는다.
    expect(Object.keys(message.images)).toEqual(["image2"]);
    expect(message.images.image2).toMatchObject({ width: 10, height: 20 });
  });
});

describe("trustsPreviewMessage", () => {
  const preview = "https://khryu.dev/preview";

  test("미리보기 주소와 같은 origin에서 온 메시지는 받는다", () => {
    expect(trustsPreviewMessage(preview, "https://khryu.dev")).toBe(true);
    expect(trustsPreviewMessage("http://localhost:3000/preview", "http://localhost:3000")).toBe(true);
  });

  test("호스트가 다르면 거부한다", () => {
    expect(trustsPreviewMessage(preview, "https://evil.dev")).toBe(false);
    expect(trustsPreviewMessage(preview, "https://blog.khryu.dev")).toBe(false);
    expect(trustsPreviewMessage(preview, "https://khryu.dev.evil.dev")).toBe(false);
  });

  test("포트가 다르면 거부한다", () => {
    expect(trustsPreviewMessage(preview, "https://khryu.dev:8443")).toBe(false);
    expect(trustsPreviewMessage("http://localhost:3000/preview", "http://localhost:3001")).toBe(false);
  });

  test("프로토콜이 다르면 거부한다", () => {
    expect(trustsPreviewMessage(preview, "http://khryu.dev")).toBe(false);
  });

  test("sandbox iframe처럼 origin이 null이거나 비어 있으면 거부한다", () => {
    expect(trustsPreviewMessage(preview, "null")).toBe(false);
    expect(trustsPreviewMessage(preview, "")).toBe(false);
  });
});

describe("previewOrigin", () => {
  test("미리보기 주소의 경로를 뗀 origin을 targetOrigin으로 준다", () => {
    expect(previewOrigin("https://khryu.dev/preview?x=1")).toBe("https://khryu.dev");
  });

  test("origin이 없는 주소면 null이라 보내지 않는다", () => {
    expect(previewOrigin("data:text/html,hi")).toBeNull();
    expect(previewOrigin("/preview")).toBeNull();
  });
});
