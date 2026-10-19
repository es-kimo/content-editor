import { describe, expect, test } from "vitest";

import { addImage, parseMdx } from "@/lib/mdx-doc";

import { checkUploads, fitImageSize, MAX_UPLOAD_BYTES, uploadExtension, usedUploads } from "./upload";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const PNG = new Uint8Array([0x89, ...ascii("PNG\r\n\x1a\n"), 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")]);
const GIF = new Uint8Array(ascii("GIF89a"));

describe("uploadExtension", () => {
  test("png·jpg·webp만 받고 확장자를 정한다", () => {
    expect(uploadExtension("image/png")).toBe("png");
    expect(uploadExtension("image/jpeg")).toBe("jpg");
    expect(uploadExtension("image/webp")).toBe("webp");
    expect(uploadExtension("image/gif")).toBeNull();
    expect(uploadExtension("image/svg+xml")).toBeNull();
    expect(uploadExtension("toString")).toBeNull();
  });
});

describe("checkUploads", () => {
  test("png·jpg·webp 이미지는 통과한다", () => {
    expect(
      checkUploads([
        { file: "1.png", content: PNG },
        { file: "2.jpg", content: JPEG },
        { file: "3.jpeg", content: JPEG },
        { file: "4.webp", content: WEBP },
      ]),
    ).toEqual({ ok: true });
  });

  test("받지 않는 형식은 format이다", () => {
    expect(checkUploads([{ file: "1.gif", content: GIF }])).toEqual({
      ok: false,
      reason: "image",
      file: "1.gif",
      problem: "format",
    });
  });

  test("확장자와 내용의 형식이 다르면 format이다", () => {
    expect(checkUploads([{ file: "1.png", content: JPEG }])).toMatchObject({ file: "1.png", problem: "format" });
    expect(checkUploads([{ file: "1.webp", content: GIF }])).toMatchObject({ problem: "format" });
  });

  test("합계가 상한을 넘으면 넘게 만든 이미지가 size다", () => {
    const half = new Uint8Array(MAX_UPLOAD_BYTES / 2);
    half.set(PNG);
    expect(
      checkUploads([
        { file: "1.png", content: half },
        { file: "2.png", content: half },
      ]),
    ).toEqual({ ok: true });
    expect(
      checkUploads([
        { file: "1.png", content: half },
        { file: "2.png", content: half },
        { file: "3.png", content: PNG },
      ]),
    ).toMatchObject({ file: "3.png", problem: "size" });
  });
});

describe("fitImageSize", () => {
  test("긴 변이 상한보다 크면 비율을 지켜 줄인다", () => {
    expect(fitImageSize(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitImageSize(1000, 3000, 2000)).toEqual({ width: 667, height: 2000 });
  });

  test("상한 이하면 줄이지 않는다", () => {
    expect(fitImageSize(2000, 1000, 2000)).toBeNull();
    expect(fitImageSize(640, 480, 2000)).toBeNull();
  });
});

describe("usedUploads", () => {
  test("올린 뒤 본문에서 지운 이미지는 뺀다", () => {
    const doc = parseMdx('import image1 from "./1.png";\n\n<Image src={image1} alt="" />\n');
    const first = addImage(doc, { extension: "png", component: "Image" });
    const second = addImage(first.doc, { extension: "jpg", component: "Image" });
    const uploads = [{ file: first.file }, { file: second.file }];

    const body = `<Image src={image1} alt="" />\n\n${second.tag}\n`;

    expect(usedUploads(second.doc, body, uploads)).toEqual([{ file: "3.jpg" }]);
  });
});
