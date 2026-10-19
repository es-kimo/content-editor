import { jsxLanguage } from "@codemirror/lang-javascript";
import { commonmarkLanguage, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import { parseMixed } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";

import { checkMdx, type MdxError, type Syntax } from "@/lib/mdx-doc";

const ESM_START = /^(?:import|export)\b/;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const expressionParser = jsxLanguage.parser.configure({ top: "SingleExpression" });

/**
 * CodeMirror 마크다운 파서에 MDX의 ESM 블록과 `{식}`을 더한다. 둘 다 JS(JSX)로 강조한다.
 * MDX처럼 ESM 블록은 맨 바깥의 `import`·`export` 줄에서 시작해 빈 줄 전까지다.
 * 다만 metadata 객체 안의 빈 줄에서 끊기지 않도록 괄호가 닫힐 때까지는 빈 줄을 넘어 이어 간다.
 */
const mdxSyntax: MarkdownConfig = {
  defineNodes: ["MdxEsm", "MdxExpression"],
  parseBlock: [
    {
      name: "MdxEsm",
      parse(cx, line) {
        if (cx.parentType().name !== "Document" || line.indent !== 0 || !ESM_START.test(line.text)) return false;
        const from = cx.lineStart;
        let to = from + line.text.length;
        let open = bracketBalance(line.text);
        while (cx.nextLine() && (open > 0 || line.text.trim() !== "")) {
          to = cx.lineStart + line.text.length;
          open += bracketBalance(line.text);
        }
        cx.addElement(cx.elt("MdxEsm", from, to));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "MdxExpression",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACE) return -1;
        let depth = 0;
        for (let i = pos; i < cx.end; i++) {
          const char = cx.char(i);
          if (char === OPEN_BRACE) depth++;
          else if (char === CLOSE_BRACE && --depth === 0) return cx.addElement(cx.elt("MdxExpression", pos, i + 1));
        }
        return -1;
      },
    },
  ],
  wrap: parseMixed((node) => {
    if (node.name === "MdxEsm") return { parser: jsxLanguage.parser };
    // 문장으로 읽으면 `{ a: 1 }`로 시작하는 식을 블록 문으로 읽어 객체를 레이블로 강조한다.
    if (node.name === "MdxExpression") {
      return { parser: expressionParser, overlay: [{ from: node.from + 1, to: node.to - 1 }] };
    }
    return null;
  }),
};

function bracketBalance(text: string): number {
  let balance = 0;
  for (const char of text) {
    if (char === "{" || char === "[" || char === "(") balance++;
    else if (char === "}" || char === "]" || char === ")") balance--;
  }
  return balance;
}

/** 원문 모드의 MDX 문법 강조. gfm을 켠 레포는 표·취소선도 강조한다. */
export function mdxLanguage(syntax: Syntax) {
  return markdown({ base: syntax.gfm ? markdownLanguage : commonmarkLanguage, extensions: mdxSyntax });
}

/** 저장 전 컴파일 검사. 오류는 그 줄 전체에 표시하고, 줄을 알 수 없으면 첫 줄에 둔다. */
export async function compileDiagnostics(doc: Text, syntax: Syntax): Promise<Diagnostic[]> {
  const check = await checkMdx(doc.toString(), syntax);
  return check.ok ? [] : [compileDiagnostic(doc, check.error)];
}

function compileDiagnostic(doc: Text, error: MdxError): Diagnostic {
  const line = doc.line(Math.min(Math.max(error.line ?? 1, 1), doc.lines));
  return { from: line.from, to: line.to, severity: "error", message: error.message };
}
