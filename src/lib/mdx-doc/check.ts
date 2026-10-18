import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { Syntax } from "./split";

export type MdxError = {
  message: string;
  /** 1부터 시작. 위치를 알 수 없는 오류는 null */
  line: number | null;
  column: number | null;
};

export type MdxCheck = { ok: true } | { ok: false; error: MdxError };

type CompileError = Error & { line?: number | null; column?: number | null; reason?: string };

/**
 * 저장 전 MDX 컴파일 검사. 사이트 빌드가 실패할 글을 커밋하지 않기 위한 것이다.
 * 브라우저와 서버 어느 쪽에서도 같은 코드로 돈다 (Node 전용 API를 쓰지 않는다).
 * 문법에 영향 주는 remark 플러그인만 사이트와 맞춘다.
 */
export async function checkMdx(source: string, syntax: Syntax = {}): Promise<MdxCheck> {
  const remarkPlugins = [...(syntax.gfm ? [remarkGfm] : []), ...(syntax.math ? [remarkMath] : [])];
  try {
    await compile(source, { remarkPlugins });
    return { ok: true };
  } catch (error) {
    const e = error as CompileError;
    return { ok: false, error: { message: e.reason ?? e.message, line: e.line ?? null, column: e.column ?? null } };
  }
}
