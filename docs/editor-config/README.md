# editor.config.json

에디터가 사이트 레포를 다루는 방법을 정하는 파일. 사이트 레포 루트에 둔다. 에디터는 이 파일을 실행하지 않고 읽기만 한다.

- 에디터는 레포의 **기본 브랜치**에서 이 파일을 읽는다. 글을 읽고 커밋할 브랜치는 그 안의 `branch`로 정한다.
- 검증 코드: [`src/lib/editor-config`](../../src/lib/editor-config). 로그인 후 첫 화면에서 레포마다 검증 결과(오류는 위치와 함께)를 보여 준다.
- 예시: [yjshd](./yjshd.editor.config.json), [blog](./blog.editor.config.json). 둘 다 테스트에서 검증하고, 픽스처 글과 path·metadata가 맞는지도 확인한다.

## 예시

```json
{
  "branch": "main",
  "syntax": { "gfm": false, "math": false },
  "collections": [
    {
      "name": "게시판",
      "path": "content/4.게시판/{slug}/page.mdx",
      "metadata": {
        "title": { "type": "string", "label": "제목", "required": true },
        "other.createdAt": { "type": "datetime", "label": "작성일" },
        "other.status": { "type": "select", "label": "상태", "options": ["ready", "draft"] }
      },
      "components": ["Image"],
      "editor": "wysiwyg"
    }
  ]
}
```

## 최상위

| 키            | 타입   | 필수 | 기본값                            | 설명                                                                                             |
| ------------- | ------ | ---- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `branch`      | 문자열 | 예   |                                   | 글을 읽고 커밋할 브랜치. 사이트가 배포하는 브랜치여야 한다                                       |
| `syntax`      | 객체   |      | `{ "gfm": false, "math": false }` | 사이트가 쓰는 remark 문법. `gfm`은 remark-gfm, `math`는 remark-math. 다르면 파싱 결과가 달라진다 |
| `collections` | 배열   | 예   |                                   | 1개 이상. 아래 컬렉션                                                                            |

## 컬렉션

| 키           | 타입   | 필수 | 기본값 | 설명                                                                      |
| ------------ | ------ | ---- | ------ | ------------------------------------------------------------------------- |
| `name`       | 문자열 | 예   |        | 화면에 보일 이름. config 안에서 겹치면 안 된다                            |
| `path`       | 문자열 | 예   |        | 글 파일 경로 패턴 (아래)                                                  |
| `metadata`   | 객체   |      | `{}`   | metadata 폼 필드. 키는 metadata 안의 위치, 값은 필드 정의 (아래)          |
| `components` | 배열   |      | `[]`   | WYSIWYG에서 삽입 UI로 보여 줄 컴포넌트 이름. 대문자로 시작, 중복 불가     |
| `editor`     | 문자열 | 예   |        | 글을 열 때의 본문 편집 모드. `"wysiwyg"`(MDXEditor) 또는 `"source"`(원문) |

`editor`가 `"wysiwyg"`여도 원문 모드 전용인 글(metadata에 식이 있는 글 등)은 원문으로 연다.

## `path` 패턴

레포 루트 기준 상대 경로. `/`로 나눈 각 단계는 고정 이름이거나 자리표시자 하나다.

| 자리표시자  | 뜻                                            |
| ----------- | --------------------------------------------- |
| `{slug}`    | 글 폴더 이름. 정확히 한 번, 파일 바로 앞 단계 |
| `{submenu}` | 하위 메뉴 폴더 이름. 선택, 한 번까지          |

- 마지막 단계는 `.mdx` 파일 이름이다. 이미지는 글 폴더(`{slug}`)에 함께 둔다.
- 자리표시자는 한 단계를 통째로 차지한다. `post-{slug}`처럼 섞어 쓸 수 없다.
- 단계 수가 같아야 맞는다. `content/3.강좌/{submenu}/{slug}/page.mdx`는 `content/3.강좌/1.동영상 강의/page.mdx`에 맞지 않는다.
- 두 컬렉션의 path가 같은 파일에 맞을 수 있으면 오류다. 한 파일은 컬렉션 하나에만 속한다.

| 패턴                                          | 맞는 파일                                                   | 값                                                  |
| --------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `content/4.게시판/{slug}/page.mdx`            | `content/4.게시판/6월 휴진 안내/page.mdx`                   | slug `6월 휴진 안내`                                |
| `content/3.강좌/{submenu}/{slug}/page.mdx`    | `content/3.강좌/2.콩팥질환 정보/투석환자의 우울증/page.mdx` | submenu `2.콩팥질환 정보`, slug `투석환자의 우울증` |
| `apps/blog/content/{submenu}/{slug}/page.mdx` | `apps/blog/content/Data/cohort-survival-analysis/page.mdx`  | submenu `Data`, slug `cohort-survival-analysis`     |

## metadata 필드

키는 `export const metadata = {...}` 안의 위치를 `.`으로 이어 쓴다 (`title`, `other.createdAt`). 각 부분은 JS 식별자여야 한다. 객체 키와 그 안의 키(`other`와 `other.status`)를 함께 정의할 수 없다. 여기 없는 기존 키는 폼에 나오지 않고 그대로 보존된다.

| 키         | 타입        | 필수     | 설명                                 |
| ---------- | ----------- | -------- | ------------------------------------ |
| `type`     | 문자열      | 예       | 아래 다섯 가지 중 하나               |
| `label`    | 문자열      |          | 폼에 보일 이름. 없으면 키를 보인다   |
| `required` | true/false  |          | 비워 둘 수 없는 필드                 |
| `options`  | 문자열 배열 | select만 | 고를 수 있는 값. 1개 이상, 중복 불가 |

| `type`     | 값          | 입력                                  |
| ---------- | ----------- | ------------------------------------- |
| `string`   | 문자열      | 한 줄                                 |
| `text`     | 문자열      | 여러 줄                               |
| `datetime` | 문자열      | 날짜·시각 (`2026-10-19T00:00:00Z` 등) |
| `select`   | 문자열      | `options` 중 하나                     |
| `string[]` | 문자열 배열 | 여러 값 (검색어 등)                   |

폼으로 저장할 때:

- config에 없는 키와 키 순서는 그대로 둔다. 원래 없던 키는 값을 채웠을 때만 끝에 더한다.
- 지금 값이 타입과 맞지 않는 필드(예: `string[]`인데 문자열)는 잠기고 원래 값을 둔다. 원문 모드에서 고친다.
- `select`·`datetime`을 비우면 키를 지운다. `string`·`text`를 비우면 빈 문자열로 둔다.
- `datetime`은 원래 값의 형식(초, 밀리초, `Z`)을 따르고 시간대 변환 없이 입력한 숫자를 그대로 쓴다. 원래 값이 없으면 `YYYY-MM-DDTHH:mm:ssZ`.
- 값을 바꾸지 않았으면 커밋하지 않는다.

## 오류

검증 오류는 config 안의 위치와 이유를 한 줄씩 알린다.

```
colections: 알 수 없는 키다
collections[0].path: 알 수 없는 자리표시자 {id}. 쓸 수 있는 것: {slug}, {submenu}
collections[0].metadata["other.status"].options: 1개 이상 있어야 한다
collections[1].name: collections[0]의 name과 같다
```

- 알 수 없는 키는 모두 오류다 (오타를 잡기 위해).
- 컬렉션 사이의 검사(name 중복, path 겹침)는 각 컬렉션에 오류가 없을 때만 한다. 앞의 오류를 고치면 새로 나올 수 있다.
