import { describe, expect, test } from "vitest";

import { parseMdx, readImageImports } from "@/lib/mdx-doc";

import {
  addUpload,
  checkUploads,
  fitImageSize,
  MAX_UPLOAD_BYTES,
  uploadExtension,
  uploadImports,
  usedUploads,
} from "./upload";

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
    expect(checkUploads([{ file: "1.gif", content: GIF }])).toMatchObject({
      ok: false,
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

const SOURCE = 'import image1 from "./1.png";\n\n<Image src={image1} alt="" />\n';

/** 이미지를 차례로 넣고 마지막 계획과 태그들을 돌려준다. 실패하면 던진다. */
function addAll(images: { extension: string; content: Uint8Array }[], files: string[] = []) {
  let plan = { doc: parseMdx(SOURCE), images: [] as { file: string; content: Uint8Array }[] };
  const tags: string[] = [];
  const added: string[] = [];
  for (const image of images) {
    const result = addUpload(plan, image, files);
    if (!result.ok) throw new Error(result.problem);
    plan = result.plan;
    tags.push(result.tag);
    added.push(result.file);
  }
  return { plan, tags, added };
}

describe("addUpload", () => {
  test("넣을 때마다 겹치지 않는 이름을 고르고 Image 태그를 돌려준다", () => {
    const { plan, tags, added } = addAll([
      { extension: "png", content: PNG },
      { extension: "jpg", content: JPEG },
    ]);
    expect(tags).toEqual(['<Image src={image2} alt="" />', '<Image src={image3} alt="" />']);
    expect(added).toEqual(["2.png", "3.jpg"]);
    expect(plan.images.map((image) => image.file)).toEqual(["2.png", "3.jpg"]);
    expect(readImageImports(plan.doc).map((image) => image.path)).toEqual(["./1.png", "./2.png", "./3.jpg"]);
  });

  test("글 폴더에 이미 있는 파일 이름은 피한다", () => {
    expect(addAll([{ extension: "png", content: PNG }], ["2.png"]).plan.images[0]?.file).toBe("3.png");
  });

  test("받지 않는 형식이나 합계 상한을 넘는 이미지는 넣지 않는다", () => {
    const plan = { doc: parseMdx(SOURCE), images: [] };
    expect(addUpload(plan, { extension: "gif", content: GIF }, [])).toMatchObject({ ok: false, problem: "format" });
    expect(addUpload(plan, { extension: "png", content: JPEG }, [])).toMatchObject({ ok: false, problem: "format" });
    const large = new Uint8Array(MAX_UPLOAD_BYTES / 2 + 1);
    large.set(PNG);
    const first = addUpload(plan, { extension: "png", content: large }, []);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(addUpload(first.plan, { extension: "png", content: large }, [])).toMatchObject({ problem: "size" });
  });
});

describe("usedUploads", () => {
  test("넣은 뒤 본문에서 지운 이미지는 뺀다", () => {
    const { plan, tags } = addAll([
      { extension: "png", content: PNG },
      { extension: "jpg", content: JPEG },
    ]);
    const body = `<Image src={image1} alt="" />\n\n${tags[1]}\n`;

    expect(usedUploads(plan, body).map((image) => image.file)).toEqual(["3.jpg"]);
  });
});

describe("uploadImports", () => {
  test("넣은 이미지만 그 import 변수명과 짝지어 돌려준다", () => {
    const { plan } = addAll([
      { extension: "png", content: PNG },
      { extension: "jpg", content: JPEG },
    ]);

    expect(uploadImports(plan).map(({ name, image }) => [name, image.file])).toEqual([
      ["image2", "2.png"],
      ["image3", "3.jpg"],
    ]);
  });
});
