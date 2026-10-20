import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { bodyChanged, editedBody, sameBodyStructure, setBody } from "./body";
import { parseMdx, printMdx } from "./split";

describe.each(fixtureSources)("픽스처 본문: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("본문을 그대로 넘기면 모든 글이 원본 그대로 조립된다", () => {
    const changed = fixtures!.filter((f) => {
      const doc = parseMdx(f.source, source.syntax);
      if (!doc.ok) return true;
      const next = setBody(doc, doc.body);
      return next !== doc || printMdx(next) !== f.source;
    });
    expect(changed.map((f) => f.path)).toEqual([]);
  });
});

describe("setBody", () => {
  const source = 'import a from "./1.png";\n\nexport const metadata = { title: "t" };\n\n# 제목\n\n본문\n';

  test("본문만 바꾸고 import와 metadata는 원본 문자열 그대로 둔다", () => {
    const doc = parseMdx(source);
    expect(printMdx(setBody(doc, "# 제목\n\n고친 본문\n"))).toBe(
      'import a from "./1.png";\n\nexport const metadata = { title: "t" };\n\n# 제목\n\n고친 본문\n',
    );
  });

  test("본문이 같으면 doc을 그대로 돌려준다", () => {
    const doc = parseMdx(source);
    expect(setBody(doc, "# 제목\n\n본문\n")).toBe(doc);
  });

  test("구간으로 나눌 수 없는 글은 바꾸지 않는다", () => {
    const doc = parseMdx("본문\n\nexport const a = 1;\n");
    expect(setBody(doc, "다른 본문\n")).toBe(doc);
  });
});

describe("editedBody", () => {
  const original = "* 하나\n* 둘\n";
  const normalized = "- 하나\n- 둘\n";

  test("열기만 하고 고치지 않았으면 에디터가 다시 쓴 본문 대신 원본을 저장한다", () => {
    expect(editedBody(original, normalized, null)).toBe(original);
  });

  test("고쳤다가 처음 상태로 되돌렸으면 원본을 저장한다", () => {
    expect(editedBody(original, normalized, normalized)).toBe(original);
    expect(editedBody(original, null, original)).toBe(original);
  });

  test("고쳤으면 고친 본문을 저장한다", () => {
    expect(editedBody(original, normalized, "- 하나\n- **둘**\n")).toBe("- 하나\n- **둘**\n");
    expect(editedBody(original, null, "* 하나\n* 셋\n")).toBe("* 하나\n* 셋\n");
  });

  test("에디터가 앞뒤 공백을 뗀 본문을 내보내도 원본의 앞뒤 공백을 지킨다", () => {
    expect(editedBody(original, normalized, "- 하나\n- **둘**")).toBe("- 하나\n- **둘**\n");
    expect(editedBody("\n* 하나\n\n", null, "* 셋")).toBe("\n* 셋\n\n");
  });

  test("에디터가 앞뒤 공백을 뗀 본문이 처음 상태와 같으면 원본을 저장한다", () => {
    expect(editedBody(original, normalized, "- 하나\n- 둘")).toBe(original);
    expect(editedBody(original, null, "* 하나\n* 둘")).toBe(original);
  });
});

describe("bodyChanged", () => {
  const original = "* 하나\n* 둘\n";
  const normalized = "- 하나\n- 둘\n";

  test("열기만 했으면 에디터가 다시 쓴 본문이 있어도 변경이 아니다", () => {
    expect(bodyChanged(original, null, null)).toBe(false);
    expect(bodyChanged(original, normalized, null)).toBe(false);
  });

  test("본문을 고치면 변경이다", () => {
    expect(bodyChanged(original, normalized, "- 하나\n- **둘**\n")).toBe(true);
    expect(bodyChanged(original, null, "* 하나\n* 셋\n")).toBe(true);
  });

  test("고쳤다가 다시 쓴 처음 상태로 되돌리면 변경이 사라진다", () => {
    expect(bodyChanged(original, normalized, normalized)).toBe(false);
    expect(bodyChanged(original, normalized, "- 하나\n- 둘")).toBe(false);
  });
});

describe("sameBodyStructure", () => {
  test("목록·강조 기호와 들여쓰기만 다르면 같은 구조다", () => {
    expect(sameBodyStructure("* 하나\n* **둘**\n", "- 하나\n- __둘__\n")).toBe(true);
    expect(sameBodyStructure("   들여 쓴 문단\n", "들여 쓴 문단\n")).toBe(true);
  });

  test("텍스트의 연속 공백과 줄바꿈 차이는 같은 구조로 본다", () => {
    expect(sameBodyStructure("기원드립니다. \n감사합니다.\n", "기원드립니다.  감사합니다.\n")).toBe(true);
  });

  test("JSX 컴포넌트와 속성 식이 같으면 같은 구조다", () => {
    expect(sameBodyStructure('<Image src={image1} alt="a" />\n', '<Image src={image1}  alt="a"/>\n')).toBe(true);
  });

  test("문단이 나뉘거나 합쳐지면 다른 구조다", () => {
    expect(sameBodyStructure("하나\n둘\n", "하나\n\n둘\n")).toBe(false);
  });

  test("글자가 바뀌거나 공백이 사라지면 다른 구조다", () => {
    expect(sameBodyStructure("안녕하세요\n", "안녕하세요!\n")).toBe(false);
    expect(sameBodyStructure("a **b** c\n", "a**b**c\n")).toBe(false);
  });

  test("이스케이프가 풀려 다른 노드가 되면 다른 구조다", () => {
    expect(sameBodyStructure("\\* 별표\n", "* 별표\n")).toBe(false);
  });

  test("JSX 속성이 바뀌면 다른 구조다", () => {
    expect(sameBodyStructure('<Image src={image1} alt="a" />\n', '<Image src={image2} alt="a" />\n')).toBe(false);
  });

  test("읽을 수 없는 본문이 있으면 다른 구조로 본다", () => {
    expect(sameBodyStructure("<Image\n", "<Image\n")).toBe(false);
  });
});
