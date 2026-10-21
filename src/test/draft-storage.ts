import type { Draft, DraftStorage } from "@/lib/content/draft";

/** 메모리 보관본 저장소. `quota`를 넘는 바이트의 첨부를 담으려 하면 브라우저 용량 부족처럼 던진다. */
export function memoryStorage({ quota = Infinity } = {}) {
  let blocked = false;
  const items = new Map<string, Draft>();
  const storage: DraftStorage = {
    keys: async () => [...items.keys()],
    get: async (key) => items.get(key),
    set: async (key, draft) => {
      const bytes = draft.attachments.reduce((sum, attachment) => sum + attachment.content.length, 0);
      if (blocked || bytes > quota) throw new DOMException("용량 부족", "QuotaExceededError");
      items.set(key, structuredClone(draft));
    },
    delete: async (key) => {
      items.delete(key);
    },
  };
  /** 이후 쓰기를 모두 막는다. 브라우저가 저장을 차단한 상태다. */
  const block = () => (blocked = true);
  return { storage, items, block };
}
