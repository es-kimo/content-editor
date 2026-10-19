import { z } from "zod";

import { compilePathPattern, PathPatternError, patternsOverlap } from "./path-pattern";

export const CONFIG_FILE = "editor.config.json";

const nonEmpty = z.string().trim().min(1);

const fieldBase = {
  /** 폼에 보일 이름. 없으면 키를 그대로 보인다. */
  label: nonEmpty.optional(),
  required: z.boolean().optional(),
};

const metadataField = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("string"), ...fieldBase }),
  z.strictObject({ type: z.literal("text"), ...fieldBase }),
  z.strictObject({ type: z.literal("datetime"), ...fieldBase }),
  z.strictObject({ type: z.literal("string[]"), ...fieldBase }),
  z.strictObject({
    type: z.literal("select"),
    ...fieldBase,
    options: z
      .array(nonEmpty)
      .min(1)
      .superRefine((options, ctx) => {
        options.forEach((option, i) => {
          if (options.indexOf(option) !== i) {
            ctx.addIssue({ code: "custom", path: [i], message: "앞에 같은 값이 있다" });
          }
        });
      }),
  }),
]);

export const METADATA_FIELD_TYPES = metadataField.options.map((option) => option.shape.type.value);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const metadataFields = z.record(z.string(), metadataField).superRefine((fields, ctx) => {
  const keys = Object.keys(fields);
  for (const key of keys) {
    if (!key.split(".").every((part) => IDENTIFIER.test(part))) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "키는 `.`으로 이은 JS 식별자여야 한다 (예: title, other.createdAt)",
      });
      continue;
    }
    // `other`와 `other.status`를 함께 두면 폼이 같은 값을 두 번 다루게 된다.
    const parent = keys.find((other) => key.startsWith(`${other}.`));
    if (parent) {
      ctx.addIssue({ code: "custom", path: [key], message: `"${parent}" 안의 키라 "${parent}"와 함께 정의할 수 없다` });
    }
  }
});

const componentName = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9_]*$/, { message: "대문자로 시작하는 JSX 컴포넌트 이름이어야 한다 (예: Image)" });

const pathPattern = z.string().superRefine((pattern, ctx) => {
  try {
    compilePathPattern(pattern);
  } catch (error) {
    if (!(error instanceof PathPatternError)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});

const collection = z.strictObject({
  /** 화면에 보일 컬렉션 이름. config 안에서 겹치면 안 된다. */
  name: nonEmpty,
  /** 레포 루트 기준 글 파일 경로 패턴. */
  path: pathPattern,
  metadata: metadataFields.default({}),
  /** WYSIWYG에서 삽입 UI로 보여 줄 컴포넌트. */
  components: z
    .array(componentName)
    .superRefine((names, ctx) => {
      names.forEach((name, i) => {
        if (names.indexOf(name) !== i) ctx.addIssue({ code: "custom", path: [i], message: "앞에 같은 값이 있다" });
      });
    })
    .default([]),
  /** 글을 열 때의 본문 편집 모드. 원문 모드 전용인 글은 이 값과 관계없이 원문으로 연다. */
  editor: z.enum(["wysiwyg", "source"]),
});

export const editorConfigSchema = z.strictObject({
  /** 읽고 커밋할 브랜치. 사이트가 배포하는 브랜치여야 한다. */
  branch: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^\s~^:?*[\\]+$/, { message: "브랜치 이름으로 쓸 수 없는 문자가 있다" }),
  /** 사이트가 쓰는 remark 문법. 다르면 파싱 결과가 달라진다. */
  syntax: z
    .strictObject({ gfm: z.boolean().default(false), math: z.boolean().default(false) })
    .default({ gfm: false, math: false }),
  collections: z
    .array(collection)
    .min(1)
    .superRefine((collections, ctx) => {
      collections.forEach((c, i) => {
        const before = collections.slice(0, i);
        const sameName = before.findIndex((b) => b.name === c.name);
        if (sameName !== -1) {
          ctx.addIssue({ code: "custom", path: [i, "name"], message: `collections[${sameName}]의 name과 같다` });
        }
        const overlap = before.findIndex((b) => patternsOverlap(b.path, c.path));
        if (overlap !== -1) {
          ctx.addIssue({
            code: "custom",
            path: [i, "path"],
            message: `collections[${overlap}]의 path("${before[overlap].path}")와 같은 파일에 맞을 수 있다`,
          });
        }
      });
    }),
});

export type EditorConfig = z.output<typeof editorConfigSchema>;
export type Collection = EditorConfig["collections"][number];
export type MetadataField = Collection["metadata"][string];
export type MetadataFieldType = MetadataField["type"];
