/** 패턴에서 쓸 수 있는 자리표시자. 각각 경로 한 단계(`/` 사이)에 해당한다. */
export const PLACEHOLDERS = ["slug", "submenu"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export type PathParams = { slug: string; submenu?: string };

type Segment = { kind: "literal"; value: string } | { kind: "placeholder"; name: Placeholder };

export type PathPattern = {
  pattern: string;
  /** 첫 자리표시자 앞까지의 고정 경로. 레포 트리에서 이 컬렉션을 찾을 때 쓴다. */
  prefix: string;
  /** 레포 루트 기준 파일 경로가 패턴에 맞으면 자리표시자 값을, 아니면 null을 돌려준다. */
  match(filePath: string): PathParams | null;
  /** 자리표시자 값으로 파일 경로를 만든다. 값이 경로 한 단계로 쓸 수 없으면 예외를 던진다. */
  build(params: PathParams): string;
};

export class PathPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPatternError";
  }
}

const PLACEHOLDER_RE = /^\{([^{}]*)\}$/;

function parseSegments(pattern: string): Segment[] {
  if (pattern.trim() === "") throw new PathPatternError("비어 있다");
  if (pattern.startsWith("/")) throw new PathPatternError("레포 루트 기준 상대 경로여야 한다 (앞의 `/`를 뺀다)");
  if (pattern.includes("\\")) throw new PathPatternError("구분자는 `/`만 쓴다");

  const segments = pattern.split("/").map((raw, i): Segment => {
    if (raw === "") throw new PathPatternError(`${i + 1}번째 단계가 비어 있다 (\`//\` 또는 끝의 \`/\`)`);
    if (raw === "." || raw === "..") throw new PathPatternError("`.`, `..` 단계는 쓸 수 없다");
    const placeholder = PLACEHOLDER_RE.exec(raw);
    if (placeholder) {
      const name = placeholder[1];
      if (!(PLACEHOLDERS as readonly string[]).includes(name)) {
        throw new PathPatternError(`알 수 없는 자리표시자 {${name}}. 쓸 수 있는 것: {slug}, {submenu}`);
      }
      return { kind: "placeholder", name: name as Placeholder };
    }
    if (raw.includes("{") || raw.includes("}")) {
      throw new PathPatternError(`자리표시자는 한 단계 전체를 차지해야 한다: "${raw}"`);
    }
    return { kind: "literal", value: raw };
  });

  const count = (name: Placeholder) => segments.filter((s) => s.kind === "placeholder" && s.name === name).length;
  if (count("slug") !== 1) throw new PathPatternError("{slug}가 정확히 한 번 있어야 한다");
  if (count("submenu") > 1) throw new PathPatternError("{submenu}는 한 번만 쓸 수 있다");

  // 이미지를 글 폴더에 함께 두므로(PRD 4.1) 글 하나가 폴더 하나다.
  const file = segments.at(-1);
  const parent = segments.at(-2);
  if (file?.kind !== "literal" || !file.value.endsWith(".mdx")) {
    throw new PathPatternError("마지막 단계는 `.mdx` 파일 이름이어야 한다 (예: page.mdx)");
  }
  if (parent?.kind !== "placeholder" || parent.name !== "slug") {
    throw new PathPatternError("파일 바로 앞 단계가 {slug}여야 한다 (예: content/{slug}/page.mdx)");
  }
  return segments;
}

/** 자리표시자 값으로 쓸 수 있는 경로 한 단계인지 확인한다. */
function isSegmentValue(value: string): boolean {
  return value !== "" && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
}

/** 패턴을 해석한다. 잘못된 패턴이면 `PathPatternError`를 던진다. */
export function compilePathPattern(pattern: string): PathPattern {
  const segments = parseSegments(pattern);
  const prefixParts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "placeholder") break;
    prefixParts.push(segment.value);
  }
  const prefix = prefixParts.join("/");

  return {
    pattern,
    prefix,
    match(filePath) {
      const parts = filePath.split("/");
      if (parts.length !== segments.length) return null;
      const params: Partial<PathParams> = {};
      for (const [i, segment] of segments.entries()) {
        const part = parts[i];
        if (segment.kind === "literal") {
          if (part !== segment.value) return null;
        } else {
          if (!isSegmentValue(part)) return null;
          params[segment.name] = part;
        }
      }
      return params as PathParams;
    },
    build(params) {
      return segments
        .map((segment) => {
          if (segment.kind === "literal") return segment.value;
          const value = params[segment.name];
          if (value === undefined || !isSegmentValue(value)) {
            throw new PathPatternError(`{${segment.name}} 값으로 쓸 수 없다: ${JSON.stringify(value)}`);
          }
          return value;
        })
        .join("/");
    },
  };
}

/** 두 패턴에 함께 맞는 파일 경로가 있을 수 있는지. 둘 다 올바른 패턴이어야 한다. */
export function patternsOverlap(a: string, b: string): boolean {
  const sa = parseSegments(a);
  const sb = parseSegments(b);
  if (sa.length !== sb.length) return false;
  return sa.every((x, i) => {
    const y = sb[i];
    return x.kind === "placeholder" || y.kind === "placeholder" || x.value === y.value;
  });
}
