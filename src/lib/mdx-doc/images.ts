import { parse } from "acorn";
import type { Program } from "estree";

import type { HeadSegment, MdxDoc } from "./split";

/** 기본 import(`import image1 from "./1.png"`)로 가져온 이미지 하나. */
export type ImageImport = { name: string; path: string };

export type AddedImage = {
  doc: MdxDoc;
  /** 새 import의 변수명 */
  name: string;
  /** 글 폴더에 저장할 파일 이름 (import 경로의 `./` 뒤) */
  file: string;
  /** 본문에 넣을 컴포넌트 태그 */
  tag: string;
};

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** head의 이미지 import를 읽는다. 이름 없는 import(`import "./a.css"`)나 `{ a }` 형태, 이미지가 아닌 경로는 제외한다. */
export function readImageImports(doc: MdxDoc): ImageImport[] {
  if (!doc.ok) return [];
  return doc.head.flatMap((segment) => {
    if (segment.kind !== "import") return [];
    const parsed = parseImport(segment.text);
    return parsed && IMAGE_EXTENSION.test(parsed.path) ? [parsed] : [];
  });
}

export type AddImageOptions = {
  extension: string;
  component: string;
  alt?: string;
  /** 글 폴더에 이미 있는 파일 이름. import하지 않은 파일도 덮어쓰지 않게 피한다. */
  files?: string[];
};

/**
 * 겹치지 않는 변수명(`imageN`)·파일명(`N.ext`)으로 이미지를 추가한다.
 * 기존 글의 `image`, `image.png` 같은 이름은 그대로 두고 번호만 이어 붙인다.
 */
export function addImage(doc: MdxDoc, options: AddImageOptions): AddedImage {
  if (!doc.ok) throw new Error("구간으로 나눌 수 없는 글에는 이미지를 추가할 수 없다");
  const extension = options.extension.replace(/^\./, "").toLowerCase();
  if (!IMAGE_EXTENSION.test(`.${extension}`)) throw new Error(`지원하지 않는 이미지 확장자: ${extension}`);

  const isFree = freeNumber(doc, options.files);
  let n = 1;
  while (!isFree(n, extension)) n += 1;
  return insertImage(doc, n, extension, options);
}

/**
 * `addImage`가 골랐던 파일 이름(`N.ext`)으로 같은 이미지를 다시 추가한다.
 * 브라우저에서 고른 이름을 서버가 다시 읽은 원본에 적용할 때 쓴다. 그 번호를 이미 쓰고 있거나 `N.ext` 꼴이 아니면 null.
 */
export function addImageAs(doc: MdxDoc, file: string, options: Omit<AddImageOptions, "extension">): AddedImage | null {
  if (!doc.ok) return null;
  const match = /^([1-9]\d*)\.([a-z]+)$/.exec(file);
  if (!match || !IMAGE_EXTENSION.test(file)) return null;
  const n = Number(match[1]);
  if (!freeNumber(doc, options.files)(n, match[2])) return null;
  return insertImage(doc, n, match[2], options);
}

/** 번호 N에 대해 변수명 `imageN`을 head·본문에서 쓰지 않고, 파일 `N.ext`를 import하지 않았고 글 폴더에도 없는지. */
function freeNumber(doc: Extract<MdxDoc, { ok: true }>, folder: string[] = []) {
  const taken = new Set<string>();
  const files = new Set(folder.map((name) => name.toLowerCase()));
  for (const segment of doc.head) {
    if (segment.kind === "gap") continue;
    for (const word of segment.text.match(/[\p{ID_Continue}$]+/gu) ?? []) taken.add(word);
  }
  for (const image of readImageImports(doc)) files.add(image.path.replace(/^\.\//, "").toLowerCase());
  return (n: number, extension: string) =>
    !taken.has(`image${n}`) && !files.has(`${n}.${extension}`) && !isUsedInBody(doc.body, `image${n}`);
}

// JSX 문자열 속성은 백슬래시 이스케이프를 해석하지 않고 문자 참조만 해석한다
function escapeJsxAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function insertImage(
  doc: Extract<MdxDoc, { ok: true }>,
  n: number,
  extension: string,
  options: { component: string; alt?: string },
): AddedImage {
  const name = `image${n}`;
  const file = `${n}.${extension}`;
  const importText = formatImport(doc.head, name, `./${file}`);
  const tag = `<${options.component} src={${name}} alt="${escapeJsxAttribute(options.alt ?? "")}" />`;
  return { doc: { ...doc, head: insertImport(doc.head, importText) }, name, file, tag };
}

/**
 * 본문(과 다른 head 구간)에서 쓰지 않는 이미지 import. 자동으로 지우지 않고 경고에만 쓴다.
 * 이름이 글자로만 나와도 쓴 것으로 본다. 경고를 놓치는 쪽이 사용 중인 이미지를 지우라고 하는 쪽보다 안전하다.
 */
export function findUnusedImageImports(doc: MdxDoc): ImageImport[] {
  if (!doc.ok) return [];
  const rest = doc.head.filter((s) => s.kind !== "import" && s.kind !== "gap").map((s) => s.text);
  return readImageImports(doc).filter((image) => ![doc.body, ...rest].some((text) => isUsedInBody(text, image.name)));
}

function isUsedInBody(text: string, name: string): boolean {
  const escaped = name.replace(/[$]/g, "\\$&");
  return new RegExp(`(?<![\\p{ID_Continue}$])${escaped}(?![\\p{ID_Continue}$])`, "u").test(text);
}

function parseImport(text: string): ImageImport | null {
  let program: Program;
  try {
    program = parse(text, { ecmaVersion: "latest", sourceType: "module" }) as unknown as Program;
  } catch {
    return null;
  }
  const statement = program.body[0];
  if (statement?.type !== "ImportDeclaration" || typeof statement.source.value !== "string") return null;
  const specifier = statement.specifiers[0];
  if (statement.specifiers.length !== 1 || specifier?.type !== "ImportDefaultSpecifier") return null;
  return { name: specifier.local.name, path: statement.source.value };
}

/** 마지막 import의 따옴표·세미콜론을 따라 새 import 문을 만든다. 없으면 prettier 기본값이다. */
function formatImport(head: HeadSegment[], name: string, path: string): string {
  const last = head.findLast((segment) => segment.kind === "import")?.text;
  const quote = last && /from\s*'/.test(last) ? "'" : '"';
  const semicolon = last && !last.trimEnd().endsWith(";") ? "" : ";";
  return `import ${name} from ${quote}${path}${quote}${semicolon}`;
}

function insertImport(head: HeadSegment[], text: string): HeadSegment[] {
  const lastImport = head.findLastIndex((segment) => segment.kind === "import");
  if (lastImport !== -1) {
    const next = head[lastImport + 1];
    // 마지막 import 바로 뒤가 gap이면 그 gap(빈 줄 등)을 새 import 뒤에 그대로 둔다.
    return [
      ...head.slice(0, lastImport + 1),
      { kind: "gap", text: "\n" },
      { kind: "import", text },
      ...head.slice(lastImport + 1),
      ...(next ? [] : [{ kind: "gap", text: "\n\n" } as const]),
    ];
  }
  // import가 없으면 맨 앞에 두고 뒤는 빈 줄로 띄운다. 뒤에 이미 gap이 있으면 그것을 쓴다.
  const separator: HeadSegment[] = head[0]?.kind === "gap" ? [] : [{ kind: "gap", text: "\n\n" }];
  return [{ kind: "import", text }, ...separator, ...head];
}
