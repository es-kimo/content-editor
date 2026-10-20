import { describe, expect, test } from "vitest";

import { bodyChanged, imageTag, parseMdx } from "@/lib/mdx-doc";
import { GIF, JPEG, PNG, SOURCE } from "@/test/upload-images";

import { createLeaveGuard, leavingAreas, type Leave } from "./leave-guard";
import { createSaveFlow, type SaveState } from "./save-flow";
import { unsavedAreas } from "./unsaved";
import { IMAGE_COMPONENT, MAX_UPLOAD_BYTES, sourceUploads, uploadExtension } from "./upload";
import { createUploadSession, type AddedUploads, type PreparedImage, type UploadSubmission } from "./upload-session";

const doc = parseMdx(SOURCE);
const BODY = doc.ok ? doc.body : "";

/** 브라우저가 넘기는 파일 대신 쓰는 값. `type`이 받지 않는 형식이면 `prepareImage`처럼 null로 준비된다. */
type TestFile = { name: string; type: string; content: Uint8Array; broken?: boolean };
const png = (name = "a.png"): TestFile => ({ name, type: "image/png", content: PNG });
const jpeg = (name = "b.jpg"): TestFile => ({ name, type: "image/jpeg", content: JPEG });
const gif = (name = "c.gif"): TestFile => ({ name, type: "image/gif", content: GIF });
/** 형식은 맞지만 이미지로 읽을 수 없는 파일. 준비가 던진다. */
const broken = (name = "d.png"): TestFile => ({ ...png(name), broken: true });

/** `prepareImage`와 같은 결과를 내되 끝나는 시점을 테스트가 정한다. */
function delayedPrepare() {
  const waiting: { file: TestFile; finish: () => void }[] = [];
  const prepare = (file: TestFile) =>
    new Promise<PreparedImage | null>((resolve, reject) => {
      waiting.push({
        file,
        finish: () => {
          const extension = uploadExtension(file.type);
          if (file.broken) reject(new Error("읽을 수 없는 이미지"));
          else resolve(extension ? { extension, content: file.content, width: 10, height: 10 } : null);
        },
      });
    });
  /** 이름이 `name`인 파일의 준비를 끝내고 그 뒤 처리가 돌 때까지 기다린다. */
  const finish = async (name: string) => {
    const index = waiting.findIndex((item) => item.file.name === name);
    waiting.splice(index, 1)[0]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { prepare, finish };
}

/** 준비가 끝나는 시점을 테스트가 정하는 세션. 본문은 편집 화면처럼 `insert`가 받은 태그를 끝에 붙여 간다. */
function setup(files: string[] = []) {
  const { prepare, finish } = delayedPrepare();
  const states: boolean[] = [];
  const session = createUploadSession({ doc, files, prepare, onPreparing: (preparing) => states.push(preparing) });
  let body = BODY;
  const inserted: AddedUploads[] = [];
  const add = (selected: TestFile[]) =>
    session.add(selected, (added) => {
      inserted.push(added);
      for (const tag of tagsOf(added)) body += `\n${tag}\n`;
    });
  return { session, finish, states, inserted, add, body: () => body, setBody: (next: string) => (body = next) };
}

const fileNames = (images: { file: string }[]) => images.map((image) => image.file);
/** 편집 화면이 넣을 태그. 대체 텍스트는 비워 둔다. */
const tagsOf = (added: AddedUploads) => added.images.map(({ name }) => imageTag(IMAGE_COMPONENT, name, ""));

describe("createUploadSession 준비 중 보호", () => {
  test("준비가 끝나기 전에는 준비 중이고 저장할 수 없으며, 본문에 넣은 뒤에 풀린다", async () => {
    const { session, finish, states, inserted, add, body } = setup();

    const done = add([png("2.png")]);

    expect(session.preparing).toBe(true);
    expect(session.unsaved(body())).toBe(true);
    expect(session.submission(body())).toEqual({ ok: false, reason: "preparing" });
    expect(inserted).toEqual([]);

    await finish("2.png");
    await done;

    expect(inserted).toHaveLength(1);
    expect(session.preparing).toBe(false);
    expect(states).toEqual([true, false]);
    expect(session.submission(body())).toMatchObject({ ok: true });
  });

  test("본문에 넣는 동안에도 준비 중이고 저장할 수 없다", async () => {
    const { prepare, finish } = delayedPrepare();
    const states: boolean[] = [];
    const session = createUploadSession({
      doc,
      files: [],
      prepare,
      onPreparing: (preparing) => states.push(preparing),
    });
    let body = BODY;
    const duringInsert: { preparing: boolean; states: boolean[]; submission: UploadSubmission }[] = [];

    const done = session.add([png("2.png")], (added) => {
      body += `\n${tagsOf(added).join("\n")}\n`;
      duringInsert.push({ preparing: session.preparing, states: [...states], submission: session.submission(body) });
    });
    await finish("2.png");
    await done;

    expect(duringInsert).toEqual([{ preparing: true, states: [true], submission: { ok: false, reason: "preparing" } }]);
    expect(session.preparing).toBe(false);
    expect(session.submission(body)).toMatchObject({ ok: true, images: [{ file: "2.png" }] });
  });

  test("본문에 넣는 중 오류가 나도 준비 중 상태는 풀린다", async () => {
    const { prepare, finish } = delayedPrepare();
    const session = createUploadSession({ doc, files: [], prepare });

    const done = session.add([png()], () => {
      throw new Error("에디터 오류");
    });
    const failed = expect(done).rejects.toThrow();
    await finish("a.png");

    await failed;
    expect(session.preparing).toBe(false);
  });

  test("여러 번 넣은 작업 중 하나만 끝나면 준비 중이 풀리지 않고, 성공·실패가 모두 끝나면 실제 본문으로 다시 판정한다", async () => {
    const { session, finish, states, add, body } = setup();

    const first = add([png("2.png")]);
    const second = add([broken("x.png")]);
    const third = add([jpeg("3.jpg")]);

    await finish("2.png");
    await first;
    expect(session.preparing).toBe(true);
    expect(session.submission(body())).toEqual({ ok: false, reason: "preparing" });

    await finish("x.png");
    await second;
    expect(session.preparing).toBe(true);

    await finish("3.jpg");
    await third;
    expect(session.preparing).toBe(false);
    expect(states).toEqual([true, false]);
    expect(session.unsaved(body())).toBe(true);
    expect(session.submission(body())).toEqual({ ok: true, images: session.plan.images });
    expect(fileNames(session.plan.images)).toEqual(["2.png", "3.jpg"]);
  });

  test("한 번에 고른 파일들은 모두 준비한 뒤 넣을 수 있는 것만 한 번에 본문에 넣는다", async () => {
    const { session, finish, inserted, add } = setup();

    const done = add([png(), gif(), jpeg()]);
    await finish("a.png");
    expect(session.preparing).toBe(true);
    expect(inserted).toEqual([]);
    await finish("c.gif");
    await finish("b.jpg");
    await done;

    expect(inserted).toEqual([
      {
        images: [
          { file: "2.png", name: "image2" },
          { file: "3.jpg", name: "image3" },
        ],
        problems: [{ name: "c.gif", problem: "format" }],
      },
    ]);
  });
});

describe("createUploadSession 첨부 판정", () => {
  /** 2.png·3.jpg를 넣고 본문에 태그까지 넣은 세션. */
  async function withTwoImages() {
    const context = setup();
    const done = context.add([png(), jpeg()]);
    await context.finish("a.png");
    await context.finish("b.jpg");
    await done;
    return context;
  }

  test("본문이 참조하는 이미지만 저장하지 않은 첨부와 제출 대상이다", async () => {
    const { session, inserted, body, setBody } = await withTwoImages();
    const [tag2, tag3] = tagsOf(inserted[0]!);

    expect(session.submission(body())).toMatchObject({ ok: true, images: [{ file: "2.png" }, { file: "3.jpg" }] });

    setBody(body().replace(tag2!, ""));
    expect(session.unsaved(body())).toBe(true);
    expect(session.submission(body())).toMatchObject({ ok: true, images: [{ file: "3.jpg" }] });

    setBody(body().replace(tag3!, ""));
    expect(session.unsaved(body())).toBe(false);
    expect(session.submission(body())).toEqual({ ok: true, images: [] });
  });

  test("추가한 참조를 모두 지우고 본문도 처음으로 되돌리면 다른 변경이 없을 때 표시가 사라진다", async () => {
    const { session, body, setBody } = await withTwoImages();
    const changed = () => ({ body: bodyChanged(BODY, BODY, body()), images: session.unsaved(body()) });
    expect(unsavedAreas(changed())).toEqual(["본문", "첨부 이미지"]);

    setBody(BODY);

    expect(unsavedAreas(changed())).toEqual([]);
    expect(unsavedAreas({ ...changed(), metadata: true })).toEqual(["글 설정"]);
  });

  test("받지 않는 형식이나 읽을 수 없는 이미지만 넣으면 계획이 그대로이고 미저장으로 남지 않는다", async () => {
    const { session, finish, inserted, add, body } = setup();

    const done = add([gif(), broken()]);
    await finish("c.gif");
    await finish("d.png");
    await done;

    expect(inserted).toEqual([
      {
        images: [],
        problems: [
          { name: "c.gif", problem: "format" },
          { name: "d.png", problem: "format" },
        ],
      },
    ]);
    expect(session.plan.images).toEqual([]);
    expect(session.unsaved(body())).toBe(false);
    expect(body()).toBe(BODY);
  });

  test("준비에 실패해도 먼저 넣은 본문과 첨부는 남는다", async () => {
    const { session, finish, add, body } = await withTwoImages();
    const before = body();

    const done = add([broken()]);
    await finish("d.png");
    await done;

    expect(body()).toBe(before);
    expect(fileNames(session.plan.images)).toEqual(["2.png", "3.jpg"]);
    expect(session.submission(body())).toMatchObject({ ok: true, images: [{ file: "2.png" }, { file: "3.jpg" }] });
  });

  test("합계 상한을 넘게 만드는 이미지는 넣지 않고 그 이유를 돌려준다", async () => {
    const large = new Uint8Array(MAX_UPLOAD_BYTES / 2 + 1);
    large.set(PNG);
    const { session, finish, inserted, add } = setup();

    const done = add([
      { ...png("big1.png"), content: large },
      { ...png("big2.png"), content: large },
    ]);
    await finish("big1.png");
    await finish("big2.png");
    await done;

    expect(inserted[0]!.problems).toEqual([{ name: "big2.png", problem: "size" }]);
    expect(fileNames(session.plan.images)).toEqual(["2.png"]);
  });

  test("글 폴더에 이미 있는 파일 이름은 피한다", async () => {
    const { session, finish, add } = setup(["2.png"]);

    const done = add([png()]);
    await finish("a.png");
    await done;

    expect(fileNames(session.plan.images)).toEqual(["3.png"]);
    expect(session.sizes.get("3.png")).toEqual({ width: 10, height: 10 });
  });
});

/** 원문 편집처럼 파일 전체로 첨부를 판정하는 세션. */
function sourceSession() {
  const { prepare, finish } = delayedPrepare();
  const session = createUploadSession({
    doc,
    files: [],
    prepare,
    used: sourceUploads,
  });
  return { session, finish };
}

/** 원문 편집 세션에 2.png를 넣고, 원문에 그 import와 태그를 더한다. */
async function withSourceImage() {
  const { session, finish } = sourceSession();
  const done = session.add([png()], () => {});
  await finish("a.png");
  await done;
  const source =
    SOURCE.replace('"./1.png";\n', '"./1.png";\nimport image2 from "./2.png";\n') +
    '\n<Image src={image2} alt="강아지" />\n';
  return { session, source };
}

describe("createUploadSession 원문 편집 첨부 판정", () => {
  test("원문이 import로 가리키는 첨부만 저장하지 않은 첨부와 제출 대상이다", async () => {
    const { session, source } = await withSourceImage();

    expect(session.unsaved(SOURCE)).toBe(false);
    expect(session.submission(SOURCE)).toEqual({ ok: true, images: [] });
    expect(session.unsaved(source)).toBe(true);
    expect(session.submission(source)).toMatchObject({ ok: true, images: [{ file: "2.png" }] });
  });

  test("태그만 지우고 import가 남으면 사이트가 파일을 찾도록 계속 올리고, import까지 지우면 올리지 않는다", async () => {
    const { session, source } = await withSourceImage();
    const withoutTag = source.replace('<Image src={image2} alt="강아지" />', "");

    expect(session.submission(withoutTag)).toMatchObject({ ok: true, images: [{ file: "2.png" }] });
    expect(session.unsaved(withoutTag.replace('import image2 from "./2.png";\n', ""))).toBe(false);
  });
});

describe("원문 편집 첨부와 저장 흐름", () => {
  const LIST: Leave = { kind: "push", href: "/repos/es-kimo/yjshd" };
  const syntax = {};

  /** 글 화면처럼 영역별 미저장을 모으는 저장 흐름과 이탈 확인. */
  function screen() {
    const flow = createSaveFlow({ navigate: () => {} });
    const guard = createLeaveGuard({ areas: () => leavingAreas(flow.getState()), go: () => {} });
    return { flow, guard };
  }

  test("원문 편집에서 이미지를 준비하는 동안 원문을 저장할 수 없고, 떠나려 하면 원문 편집 첨부를 잃는다고 묻는다", async () => {
    const { session, finish } = sourceSession();
    const { flow, guard } = screen();

    const done = session.add([png()], () => {});
    flow.report("sourceImages", session.unsaved(SOURCE));

    expect(session.submission(SOURCE)).toEqual({ ok: false, reason: "preparing" });
    expect(guard.request(LIST)).toBe(false);
    expect(guard.getState().areas).toEqual(["sourceImages"]);
    expect(unsavedAreas(flow.getState().changed)).toEqual(["원문 편집 첨부 이미지"]);
    await finish("a.png");
    await done;
  });

  test("원문 저장이 실패하거나 충돌해도 원문과 첨부가 미저장으로 남고 같은 첨부로 다시 제출한다", async () => {
    const { session, source } = await withSourceImage();
    const { flow, guard } = screen();
    flow.report("source", true);
    flow.report("sourceImages", session.unsaved(source));
    const conflict: SaveState = { status: "error", message: "글을 연 뒤 다른 곳에서 글이 바뀌었어요." };

    flow.request({ target: "source", before: SOURCE, after: source, syntax }, async () => conflict);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().changed).toEqual({ source: true, sourceImages: true });
    expect(session.submission(source)).toMatchObject({ ok: true, images: [{ file: "2.png" }] });
    expect(guard.request(LIST)).toBe(false);
  });

  test("원문 이미지 저장이 성공해도 일반 편집의 미저장 첨부를 저장한 것으로 치지 않는다", async () => {
    const { source } = await withSourceImage();
    const { flow, guard } = screen();
    flow.report("images", true);
    flow.report("sourceImages", true);

    // 본문이 바뀌는 원문 저장은 일반 편집을 다시 열므로 그 첨부를 버릴지 먼저 묻는다.
    flow.request({ target: "source", before: SOURCE, after: source, syntax }, async () => ({
      status: "saved",
      href: "/saved",
    }));
    expect(flow.getState().phase).toMatchObject({ kind: "confirming", discarded: ["images"] });
    flow.cancel();

    // 본문을 바꾸지 않는 원문 저장이 성공하면 일반 편집 첨부는 미저장으로 남아 떠날 때 묻는다.
    const importOnly = SOURCE.replace('"./1.png";\n', '"./1.png";\nimport image2 from "./2.png";\n');
    flow.request({ target: "source", before: SOURCE, after: importOnly, syntax }, async () => ({
      status: "saved",
      href: "/saved",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.getState().phase).toMatchObject({ kind: "saved" });
    expect(guard.request(LIST)).toBe(false);
    expect(guard.getState().areas).toEqual(["images"]);
  });
});
