# 구조 기준

구현·리뷰 에이전트와 사람이 같이 쓰는 기준이다. `maintainability-review` 스킬은 이 문서를 일반 기준보다 우선한다.
이 문서는 사람이 고친다. 에이전트 PR은 이 문서를 수정할 수 없고, 바꿀 필요가 있으면 PR 본문 `## 리뷰 포인트`에 제안한다.

## 모듈과 의존 방향

```
src/app (화면, 서버 액션, 라우트)
  └─ src/app/_lib (화면 공용: 로그인 링크, 세션 → 토큰, 레포 config 로드)
       └─ src/lib/content ─ src/lib/metadata-form ─ src/lib/auth ─ src/lib/sites
            └─ src/lib/editor-config
                 └─ src/lib/mdx-doc
```

| 모듈            | 책임                                                               | 의존해도 되는 것                                              |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `mdx-doc`       | MDX 원문 분해·조립, metadata 읽기·쓰기, 이미지 import, 컴파일 검사 | npm 패키지만. UI·GitHub·`@/lib/*` 금지 (lint로 막는다)        |
| `editor-config` | `editor.config.json` 스키마, 경로 패턴                             | `mdx-doc` 타입                                                |
| `metadata-form` | config 필드 ↔ 폼 값 변환                                           | `editor-config`, `mdx-doc`. GitHub·UI 금지                    |
| `content`       | GitHub에서 글 목록·읽기·커밋                                       | `editor-config`, `mdx-doc`, `metadata-form`                   |
| `auth`          | GitHub App 로그인, 세션 쿠키, 토큰 갱신                            | 없음                                                          |
| `sites`         | Host → 레포 고정                                                   | 없음                                                          |
| `src/app`       | 화면. 위 모듈을 조합만 한다                                        | 전부. `src/lib`은 `@/app`을 import하지 않는다 (lint로 막는다) |

## 재사용해야 하는 것

새로 만들기 전에 아래를 쓴다. 쓸 수 없으면 이유를 PR 본문 `## 리뷰 포인트`에 적는다.

| 하려는 일                                  | 쓸 것                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub REST·GraphQL 호출                   | `createGitHubClient` (`src/lib/content/client.ts`, 부채 정리 뒤 `src/lib/github/`). 401·404 판단은 `GitHubApiError.status` 하나로 한다 |
| 화면에서 토큰 얻기 (만료 시 갱신 라우트로) | `pageAccessToken` (`src/app/_lib/session.ts`)                                                                                          |
| 화면에서 레포 config 읽기와 실패 안내      | `loadRepoConfig` (`src/app/_lib/repo.tsx`)                                                                                             |
| 경로가 어느 컬렉션인지                     | `findCollection` (`src/lib/content/read.ts`)                                                                                           |
| 이미지 확장자 판단                         | `isImageFile` (`src/lib/content/read.ts`)                                                                                              |
| 실패를 호출자가 처리해야 하는 결과         | 판별 유니언 `{ ok: false; reason: "..." }`. 예상한 실패에는 throw하지 않는다                                                           |
| 외부 의존(fetch, 현재 시각)                | 인자로 받는다 (`fetchFn`, `now`). 테스트가 주입한다                                                                                    |

## 규칙

- 같은 외부 시스템(GitHub)을 부르는 래퍼를 새로 만들지 않는다. 클라이언트에 없는 기능은 클라이언트에 더한다.
- 호출자 둘 이상이 같은 전처리를 반복하게 되면, 그 처리를 모듈의 함수로 만든다.
- 화면 컴포넌트는 데이터 변환을 하지 않는다. 변환은 `src/lib`의 함수로 두고 테스트한다.
- 주석은 코드만 봐서 알 수 없는 이유만 적는다 (CLAUDE.md). JSDoc은 바로 아래 선언에 붙는다. 사이에 다른 선언을 끼워 넣지 않는다.

## 알려진 부채

새 코드가 따라 할 선례가 아니다. 고치는 이슈가 생기면 이 표에서 지운다.

| 부채                                                                         | 위치                                                                        | 바람직한 모양                                                                                                                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub HTTP 래퍼가 3개이고 오류 클래스도 3개다. 401 처리가 호출자마다 다르다 | `auth/github.ts` `api()`, `editor-config/load.ts`, `content/client.ts`      | `src/lib/github/`의 클라이언트 하나와 오류 하나. `content` 밑에 두면 `editor-config`와 순환하므로 옮긴다. 그 뒤 사람이 lint 예외에서 세 파일을 지운다 |
| 화면이 세션을 직접 해석한다                                                  | `src/app/page.tsx` `readPageSession`, `post/actions.ts`                     | `src/app/_lib/session.ts` 한 곳                                                                                                                       |
| metadata 구간을 찾아 파싱하는 처리를 호출자마다 반복한다                     | `content/read.ts`, `content/summary.ts`, `mdx-doc/metadata-print.ts`        | `mdx-doc`에 `readMetadata(doc)`                                                                                                                       |
| 중첩 키 접근이 두 벌이다                                                     | `metadata-form/form.ts` `lookup`, `content/summary.ts` `stringAt`           | 하나로                                                                                                                                                |
| 폴더 목록(Contents API) 읽기와 `ContentsEntry` 타입이 두 벌이다              | `content/read.ts`, `content/commit.ts`                                      | `content`의 내부 함수 하나                                                                                                                            |
| 이미지 확장자 목록이 두 벌이다                                               | `mdx-doc/images.ts` `IMAGE_EXTENSION`, `content/read.ts` `IMAGE_EXTENSIONS` | `mdx-doc`에서 export해 `content`가 쓴다                                                                                                               |
| `form.ts`가 폼 매핑, 중첩 키 접근, 날짜 형식을 한 파일에 담는다              | `metadata-form/form.ts`                                                     | 중첩 키·날짜를 파일로 분리                                                                                                                            |
| `addImage`의 JSDoc이 `escapeJsxAttribute` 위에 붙어 있다                     | `mdx-doc/images.ts:31-38`                                                   | 주석을 `addImage` 바로 위로                                                                                                                           |
