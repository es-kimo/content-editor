import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // docs/review/architecture.md의 의존 방향을 리뷰가 아니라 lint로 막는다. 뒤에 오는 블록이 같은 규칙을 덮어쓰므로 좁은 범위를 뒤에 둔다.
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/app", "@/app/*"], message: "src/lib은 화면(@/app)에 의존하지 않는다." }] },
      ],
    },
  },
  {
    files: ["src/lib/mdx-doc/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/*", "@/app", "@/app/*", "next", "next/*", "react", "react/*", "react-dom", "react-dom/*"],
              message: "mdx-doc은 UI와 GitHub에 의존하지 않는다.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/content/client.ts",
      "src/test/**",
      "**/*.test.ts",
      // 알려진 부채 (docs/review/architecture.md). 클라이언트로 합치면 지운다.
      "src/lib/auth/github.ts",
      "src/lib/editor-config/load.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/api\\.github\\.com/], TemplateElement[value.raw=/api\\.github\\.com/]",
          message: "GitHub API는 createGitHubClient(src/lib/content/client.ts)로 부른다.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
