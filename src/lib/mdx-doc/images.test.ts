import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { addImage, addImageAs, findUnusedImageImports, readImageImports } from "./images";
import { parseMdx, printMdx } from "./split";

describe.each(fixtureSources)("픽스처 이미지 import: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 글의 import에서 변수명과 경로를 읽는다", () => {
    const wrong: string[] = [];
    let total = 0;
    for (const f of fixtures!) {
      const doc = parseMdx(f.source, source.syntax);
      const expected = [
        ...f.source.matchAll(/^import\s+([^\s{}*,]+)\s+from\s*["']([^"']+\.(?:png|jpe?g|gif|webp|avif|svg))["']/gim),
      ].map((m) => ({ name: m[1], path: m[2] }));
      const actual = readImageImports(doc);
      total += actual.length;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) wrong.push(f.path);
    }
    expect(wrong).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });

  test.skipIf(!fixtures)("이미지를 추가해도 다시 파싱되고 기존 import는 그대로이며 이름이 겹치지 않는다", () => {
    const failed: string[] = [];
    for (const f of fixtures!) {
      const doc = parseMdx(f.source, source.syntax);
      if (!doc.ok) continue;
      const before = readImageImports(doc);
      const added = addImage(doc, { extension: "png", component: "Image" });
      const printed = printMdx(added.doc);
      const reparsed = parseMdx(printed, source.syntax);
      const after = reparsed.ok ? readImageImports(reparsed) : [];
      const names = after.map((i) => i.name);
      const ok =
        reparsed.ok &&
        new Set(names).size === names.length &&
        after.length === before.length + 1 &&
        before.every((b) => after.some((a) => a.name === b.name && a.path === b.path)) &&
        printed.endsWith(doc.body);
      if (!ok) failed.push(f.path);
    }
    expect(failed).toEqual([]);
  });

  test.skipIf(!fixtures)("이미지 2장을 고른 파일 이름으로 다시 추가하면 addImage와 같은 글이 된다", () => {
    const failed: string[] = [];
    for (const f of fixtures!) {
      const doc = parseMdx(f.source, source.syntax);
      if (!doc.ok) continue;
      const first = addImage(doc, { extension: "png", component: "Image" });
      const second = addImage(first.doc, { extension: "jpg", component: "Image" });
      const firstAgain = addImageAs(doc, first.file, { component: "Image" });
      const secondAgain = firstAgain && addImageAs(firstAgain.doc, second.file, { component: "Image" });
      if (!secondAgain || printMdx(secondAgain.doc) !== printMdx(second.doc)) failed.push(f.path);
    }
    expect(failed).toEqual([]);
  });

  test.skipIf(!fixtures)("미사용 감지는 모든 글에서 던지지 않는다", () => {
    for (const f of fixtures!) findUnusedImageImports(parseMdx(f.source, source.syntax));
  });
});

const sample =
  'import image from "./image.png";\n\nexport const metadata = { title: "t" };\n\n<Image src={image} alt="a" />\n';

describe("readImageImports", () => {
  test("이미지가 아닌 import와 이름 없는 import는 제외한다", () => {
    const doc = parseMdx(
      'import a from "./1.png";\nimport { b } from "./b.png";\nimport "./s.css";\nimport App from "./App";\nimport 한글 from "./img/한글.png";\n\n본문\n',
    );
    expect(readImageImports(doc)).toEqual([
      { name: "a", path: "./1.png" },
      { name: "한글", path: "./img/한글.png" },
    ]);
  });

  test("구간으로 나눌 수 없는 글은 빈 목록이다", () => {
    expect(readImageImports(parseMdx("<a"))).toEqual([]);
  });
});

describe("addImage", () => {
  test("기존 이름과 겹치지 않는 변수명·파일명을 만들고 마지막 import 뒤에 넣는다", () => {
    const added = addImage(parseMdx(sample), { extension: "png", component: "Image", alt: "새 그림" });
    expect(added.name).toBe("image1");
    expect(added.file).toBe("1.png");
    expect(added.tag).toBe('<Image src={image1} alt="새 그림" />');
    expect(printMdx(added.doc)).toBe(
      'import image from "./image.png";\nimport image1 from "./1.png";\n\nexport const metadata = { title: "t" };\n\n<Image src={image} alt="a" />\n',
    );
  });

  test("이미 쓰인 번호는 건너뛴다", () => {
    const doc = parseMdx('import image1 from "./1.png";\nimport image2 from "./image2.png";\n\n본문\n');
    expect(addImage(doc, { extension: "png", component: "Image" }).name).toBe("image3");
  });

  test("변수명이 달라도 같은 파일명이면 건너뛴다", () => {
    const doc = parseMdx('import foo from "./1.png";\n\n본문\n');
    const added = addImage(doc, { extension: ".PNG", component: "Img" });
    expect(added.file).toBe("2.png");
    expect(added.tag).toBe('<Img src={image2} alt="" />');
  });

  test("본문에서 이미 쓰는 이름은 피한다", () => {
    expect(addImage(parseMdx("{image1}\n"), { extension: "jpg", component: "Image" }).name).toBe("image2");
  });

  test("import가 없으면 맨 앞에 넣고 빈 줄로 띄운다", () => {
    const added = addImage(parseMdx("export const metadata = {};\n\n본문\n"), { extension: "png", component: "Image" });
    expect(printMdx(added.doc)).toBe('import image1 from "./1.png";\n\nexport const metadata = {};\n\n본문\n');
    const bare = addImage(parseMdx("본문\n"), { extension: "png", component: "Image" });
    expect(printMdx(bare.doc)).toBe('import image1 from "./1.png";\n\n본문\n');
  });

  test("기존 import의 따옴표와 세미콜론 스타일을 따른다", () => {
    const added = addImage(parseMdx("import a from './a.png'\n\n본문\n"), { extension: "png", component: "Image" });
    expect(printMdx(added.doc)).toBe("import a from './a.png'\nimport image1 from './1.png'\n\n본문\n");
  });

  test("추가한 결과가 다시 파싱된다", () => {
    const added = addImage(parseMdx(sample), { extension: "webp", component: "Image" });
    expect(parseMdx(printMdx(added.doc)).ok).toBe(true);
  });

  test.each(['그는 "안녕"', "경로 C:\\temp\\n", "줄\n바꿈", "R&D &amp; &quot;"])(
    "alt에 특수문자가 있어도 tag가 파싱되고 alt가 보존된다: %j",
    (alt) => {
      const added = addImage(parseMdx(sample), { extension: "png", component: "Image", alt });
      expect(parseMdx(`${added.tag}\n`).ok).toBe(true);
      const tree = fromMarkdown(added.tag, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] });
      const element = tree.children[0] as { attributes: { name: string; value: unknown }[] };
      expect(element.attributes.find((a) => a.name === "alt")?.value).toBe(alt);
    },
  );

  test("지원하지 않는 확장자와 파싱 실패 글은 거부한다", () => {
    expect(() => addImage(parseMdx(sample), { extension: "exe", component: "Image" })).toThrow();
    expect(() => addImage(parseMdx("<a"), { extension: "png", component: "Image" })).toThrow();
  });

  test("import하지 않았어도 글 폴더에 있는 파일 이름은 피한다", () => {
    const added = addImage(parseMdx(sample), { extension: "png", component: "Image", files: ["1.PNG", "2.jpg"] });
    expect(added.file).toBe("2.png");
  });

  test("앞서 추가한 doc에 이어 추가하면 다음 번호를 쓴다", () => {
    const first = addImage(parseMdx(sample), { extension: "png", component: "Image" });
    const second = addImage(first.doc, { extension: "jpg", component: "Image" });
    expect([first.file, second.file]).toEqual(["1.png", "2.jpg"]);
  });
});

describe("addImageAs", () => {
  test("addImage가 고른 파일 이름으로 원본에 다시 추가하면 같은 import와 tag가 된다", () => {
    const doc = parseMdx(sample);
    const first = addImage(doc, { extension: "png", component: "Image" });
    const second = addImage(first.doc, { extension: "webp", component: "Image" });

    // 첫 이미지를 본문에서 지웠으면 두 번째 이미지만 다시 추가한다.
    const again = addImageAs(doc, second.file, { component: "Image" });

    expect(again?.name).toBe("image2");
    expect(again?.tag).toBe(second.tag);
    expect(readImageImports(again!.doc)).toContainEqual({ name: "image2", path: "./2.webp" });
  });

  test("번호를 이미 쓰고 있으면 null이다", () => {
    const doc = parseMdx('import image1 from "./1.png";\n\n{image2}\n');
    expect(addImageAs(doc, "1.png", { component: "Image" })).toBeNull();
    expect(addImageAs(doc, "2.png", { component: "Image" })).toBeNull();
    expect(addImageAs(doc, "3.png", { component: "Image", files: ["3.png"] })).toBeNull();
    expect(addImageAs(doc, "3.png", { component: "Image" })?.name).toBe("image3");
  });

  test.each(["image.png", "0.png", "1.exe", "../1.png", "1.PNG"])(
    "N.ext 꼴이 아닌 파일 이름은 null이다: %s",
    (file) => {
      expect(addImageAs(parseMdx(sample), file, { component: "Image" })).toBeNull();
    },
  );
});

describe("findUnusedImageImports", () => {
  test("본문에서 쓰지 않는 이미지 import만 돌려준다", () => {
    const doc = parseMdx(
      'import a from "./a.png";\nimport b from "./b.png";\nimport ab from "./ab.png";\n\n<Image src={ab} />\n',
    );
    expect(findUnusedImageImports(doc)).toEqual([
      { name: "a", path: "./a.png" },
      { name: "b", path: "./b.png" },
    ]);
  });

  test("삭제하지 않고 doc도 바꾸지 않는다", () => {
    const doc = parseMdx(sample);
    findUnusedImageImports(doc);
    expect(printMdx(doc)).toBe(sample);
  });
});
