import { vi } from "vitest";

export type Route = (url: URL, init: RequestInit | undefined) => Response | undefined;

/** URL별로 응답을 정하는 fetch 모의. 처리하는 route가 없으면 테스트가 실패하도록 예외를 던진다. */
export function mockFetch(...routes: Route[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    for (const route of routes) {
      const res = route(url, init);
      if (res) return res;
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  });
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** 모의 fetch에 보낸 form 본문을 읽는다. */
export function formBody(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams));
}
