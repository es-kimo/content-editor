import { describe, expect, test } from "vitest";

import { removeConfirm } from "./remove-confirm";

describe("removeConfirm", () => {
  test("저장된 글의 삭제 확인은 제목과 초안 복구, 첨부 보존, 사이트 반영 지연을 알리고 ‘삭제’로 실행한다", () => {
    const confirm = removeConfirm({ action: "trash", title: "11월 휴진 안내", status: "ready", lost: [] });

    expect(confirm.kind).toBe("confirm");
    if (confirm.kind !== "confirm") return;
    const text = `${confirm.title} ${confirm.message}`;
    expect(confirm.title).toContain("‘11월 휴진 안내’");
    expect(text).toContain("휴지통에서 초안으로 복구할 수 있어요");
    expect(text).toContain("첨부 이미지는 지우지 않아요");
    expect(text).toContain("사이트에서 사라지기까지 시간이 걸릴 수 있어요");
    expect(confirm.confirmLabel).toBe("삭제");
  });

  test("미저장 입력이 있으면 휴지통 이동 확인 전에 바뀐 곳을 보이고 저장하거나 버리기를 먼저 고르게 한다", () => {
    const confirm = removeConfirm({ action: "trash", title: "안내", status: "draft", lost: ["body", "metadata"] });

    expect(confirm.kind).toBe("unsaved");
    if (confirm.kind !== "unsaved") return;
    expect(confirm.areas).toEqual(["글 설정", "본문"]);
    expect(confirm.message).toContain("바뀐 곳: 글 설정, 본문");
    expect(confirm.message).toContain("저장하거나 버려 주세요");
  });

  test("먼저 하는 저장은 글의 상태를 바꾸지 않는 저장이다", () => {
    const save = (status: "draft" | "ready") => {
      const confirm = removeConfirm({ action: "trash", title: "안내", status, lost: ["body"] });
      return confirm.kind === "unsaved" ? confirm.save : null;
    };

    expect(save("draft")).toBe("save-draft");
    expect(save("ready")).toBe("update");
  });

  test("저장한 적 없는 새 글은 휴지통 대신 작성 취소를 확인하고 이 브라우저의 보관본도 지운다고 알린다", () => {
    const confirm = removeConfirm({ action: "cancel", title: "", status: "draft", lost: ["title", "body"] });

    expect(confirm).toMatchObject({ kind: "confirm", action: "cancel", confirmLabel: "작성 취소" });
    if (confirm.kind !== "confirm") return;
    expect(`${confirm.title} ${confirm.message}`).not.toContain("휴지통");
    expect(confirm.message).toContain("이 브라우저에 보관한 입력도 지워져요");
  });
});
