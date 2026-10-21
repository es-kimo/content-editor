import { describe, expect, test } from "vitest";

import { parseMdx } from "@/lib/mdx-doc";
import { editorElements } from "@/test/editor-elements";
import { fixtureSources, loadFixtures } from "@/test/fixtures";

import {
  bodyImagePhoto,
  missingBodyImage,
  missingImagesInBody,
  missingInsertImage,
  repoImageHref,
  type BodyImageSources,
} from "./body-image";
import { bodyInserts, insertEntries, isImageInsert } from "./insert-form";

const REPO = "es-kimo/yjshd";
const POST = "content/게시판/일반/page.mdx";
const BLOB = "blob:https://editor.test/1";

const doc = parseMdx(`import image1 from "./1.png";
import image2 from "./2.png";

export const metadata = { title: "글" };

# 글
`);
const saved: BodyImageSources = { inserted: {}, post: { repo: REPO, path: POST } };

const element = (tag: string) => editorElements(tag)[0]!;

describe("bodyImagePhoto", () => {
  test("넣은 이미지는 import 변수명에 맞는 브라우저 안 주소와 대체 텍스트로 그린다", () => {
    const sources = { ...saved, inserted: { image2: BLOB } };
    expect(bodyImagePhoto(doc, element('<Image src={image2} alt="새 사진" />'), sources)).toEqual({
      src: BLOB,
      alt: "새 사진",
    });
  });

  test("저장된 이미지는 글 경로와 import 경로로 레포 이미지 라우트 주소를 쓴다", () => {
    const photo = bodyImagePhoto(doc, element('<Image src={image1} alt="병원 입구" />'), saved);
    expect(photo).toEqual({ src: repoImageHref(REPO, POST, "./1.png"), alt: "병원 입구" });
    const href = new URL(photo!.src, "https://editor.test");
    expect(href.pathname).toBe(`/repos/${REPO}/image`);
    expect(href.searchParams.get("post")).toBe(POST);
    expect(href.searchParams.get("src")).toBe("./1.png");
  });

  test("대체 텍스트가 없거나 따옴표가 든 이미지도 사진으로 그리고 대체 텍스트는 원문 값 그대로다", () => {
    expect(bodyImagePhoto(doc, element("<Image src={image1} />"), saved)?.alt).toBe("");
    expect(bodyImagePhoto(doc, element('<Image src={image1} alt="&quot;입구&quot; & 계단" />'), saved)?.alt).toBe(
      '"입구" & 계단',
    );
  });

  test("새 글은 레포에 저장된 이미지가 없어 넣은 이미지만 주소가 있다", () => {
    const sources = { inserted: { image2: BLOB }, post: null };
    expect(bodyImagePhoto(doc, element('<Image src={image1} alt="a" />'), sources)).toBeNull();
    expect(bodyImagePhoto(doc, element('<Image src={image2} alt="b" />'), sources)?.src).toBe(BLOB);
  });

  test("src={식}이면 주소가 없다", () => {
    expect(bodyImagePhoto(doc, element('<Image src={images[0]} alt="a" />'), saved)).toBeNull();
    expect(bodyImagePhoto(doc, element('<Image src={image1} alt={"a"} />'), saved)).toBeNull();
    expect(bodyImagePhoto(doc, element("<Image src={image1} {...rest} />"), saved)).toBeNull();
  });

  test("import가 없는 변수나 문자열 경로면 주소가 없다", () => {
    expect(bodyImagePhoto(doc, element('<Image src={image9} alt="a" />'), saved)).toBeNull();
    expect(bodyImagePhoto(doc, element('<Image src="/banner.png" alt="a" />'), saved)).toBeNull();
    expect(
      bodyImagePhoto(doc, element('<Image src={image9} alt="a" />'), { ...saved, inserted: { image2: BLOB } }),
    ).toBeNull();
  });

  test("이미지가 아닌 컴포넌트와 읽을 수 없는 글은 주소가 없다", () => {
    expect(bodyImagePhoto(doc, element('<Footnote id="1">각주</Footnote>'), saved)).toBeNull();
    expect(
      bodyImagePhoto(parseMdx("# 글\n\nexport const a = 1;\n"), element("<Image src={image1} />"), saved),
    ).toBeNull();
  });
});

describe("missingBodyImage", () => {
  test("복구한 보관본에서 파일이 빠진 첨부를 가리키는 이미지는 그 첨부 이름과 대체 텍스트를 돌려준다", () => {
    expect(missingBodyImage(doc, element('<Image src={image3} alt="빠진 사진" />'), ["3.png"])).toEqual({
      missing: "3.png",
      alt: "빠진 사진",
    });
    expect(missingBodyImage(doc, element("<Image src={image4} />"), ["3.png", "4.webp"])).toEqual({
      missing: "4.webp",
      alt: "",
    });
  });

  test("이미 import가 있는 이미지와 빠진 첨부가 아닌 변수는 빠진 첨부로 보지 않는다", () => {
    expect(missingBodyImage(doc, element('<Image src={image1} alt="a" />'), ["3.png"])).toBeNull();
    expect(missingBodyImage(doc, element('<Image src={image4} alt="a" />'), ["3.png"])).toBeNull();
    expect(missingBodyImage(doc, element('<Image src={image3} alt="a" />'), [])).toBeNull();
  });

  test("다시 고른 이미지가 빠진 첨부와 같은 이름을 받아 import가 있으면 빠진 첨부로 보지 않는다", () => {
    expect(missingBodyImage(doc, element('<Image src={image2} alt="다시 고름" />'), ["2.png"])).toBeNull();
  });

  test("src={식}으로 쓰거나 이미지가 아닌 컴포넌트는 빠진 첨부로 보지 않는다", () => {
    expect(missingBodyImage(doc, element('<Image src={image3.src} alt="a" />'), ["3.png"])).toBeNull();
    expect(missingBodyImage(doc, element('<Footnote id="3">image3</Footnote>'), ["3.png"])).toBeNull();
  });
});

describe("missingInsertImage", () => {
  const body = [
    "# 글",
    "",
    '<Image src={image3} alt="빠진 사진" />',
    "",
    '<Image src={image4} alt="경로 없음" />',
  ].join("\n");
  const limited = () => {
    const list = bodyInserts(doc, body);
    if (!list.ok) throw new Error(list.reason);
    return list.limited;
  };

  test("삽입 항목 목록이 import 없는 이미지로 읽은 항목 중 빠진 첨부를 가리키는 것만 그 첨부 이름을 돌려준다", () => {
    const [missing, other] = limited();

    expect(missingInsertImage(doc, body, missing!, ["3.png"])).toBe("3.png");
    expect(missingInsertImage(doc, body, other!, ["3.png"])).toBeNull();
  });

  test("본문 안 표시와 같은 항목을 빠진 첨부로 본다", () => {
    const [missing] = limited();

    expect(missingInsertImage(doc, body, missing!, ["3.png"])).toBe(
      missingBodyImage(doc, element('<Image src={image3} alt="빠진 사진" />'), ["3.png"])?.missing,
    );
  });

  test("빠진 첨부가 없거나 폼으로 고칠 수 있는 항목은 빠진 첨부로 보지 않는다", () => {
    const [missing] = limited();
    const list = bodyInserts(doc, '<Image src={image1} alt="a" />');
    const item = list.ok ? list.items[0]! : null;

    expect(missingInsertImage(doc, body, missing!, [])).toBeNull();
    expect(item && missingInsertImage(doc, '<Image src={image1} alt="a" />', item, ["1.png"])).toBeNull();
  });
});

describe("missingImagesInBody", () => {
  const body = (...tags: string[]) => ["# 글", "", ...tags].join("\n\n") + "\n";

  test("본문이 아직 가리키는 빠진 첨부 이름을 한 번씩 돌려준다", () => {
    const text = body('<Image src={image3} alt="a" />', '<Image src={image1} alt="b" />', "<Image src={image3} />");
    expect(missingImagesInBody(doc, text, ["3.png", "4.png"])).toEqual(["3.png"]);
  });

  test("빠진 첨부를 본문에서 지웠거나 빠진 첨부가 없으면 빈 목록이다", () => {
    expect(missingImagesInBody(doc, body('<Image src={image1} alt="b" />'), ["3.png"])).toEqual([]);
    expect(missingImagesInBody(doc, body("<Image src={image3} />"), [])).toEqual([]);
  });

  test("다시 고른 이미지가 빠진 첨부와 같은 이름을 받아 import가 있으면 빠진 첨부로 세지 않는다", () => {
    expect(missingImagesInBody(doc, body("<Image src={image2} />"), ["2.png"])).toEqual([]);
  });
});

describe.each(fixtureSources.map((source) => [source.name, source.syntax, loadFixtures(source.name)] as const))(
  "픽스처 본문 이미지 사진: %s",
  (_, syntax, fixtures) => {
    test.skipIf(!fixtures)(
      "폼이 고칠 수 있는 이미지만 그 import 경로의 사진이 되고 나머지 이미지는 주소가 없다",
      () => {
        const wrong: string[] = [];
        let photos = 0;
        for (const fixture of fixtures!) {
          const opened = parseMdx(fixture.source, syntax);
          if (!opened.ok) continue;
          const list = bodyInserts(opened, opened.body, syntax);
          if (!list.ok) continue;
          const source = { inserted: {}, post: { repo: REPO, path: fixture.path } };
          // 고치지 않은 본문의 삽입 항목 위치는 글 원문의 위치와 같다.
          for (const entry of insertEntries(list).filter((found) => found.kind === "image")) {
            const photo = bodyImagePhoto(opened, element(fixture.source.slice(entry.from, entry.to)), source, syntax);
            const expected = isImageInsert(entry)
              ? { src: repoImageHref(REPO, fixture.path, entry.path), alt: entry.alt }
              : null;
            if (JSON.stringify(photo) !== JSON.stringify(expected)) wrong.push(`${fixture.path}@${entry.from}`);
            if (photo) photos += 1;
          }
        }
        expect(wrong).toEqual([]);
        expect(photos).toBeGreaterThan(0);
      },
    );
  },
);
