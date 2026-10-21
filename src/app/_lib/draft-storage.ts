// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 보관본 타입만 가져온다.
import type { Draft, DraftStorage } from "@/lib/content/draft";

const DB_NAME = "content-editor";
const STORE = "drafts";

let opened: Promise<IDBDatabase> | null = null;

/** 보관본 데이터베이스를 한 번만 연다. 열지 못하면 다음 호출에서 다시 시도한다. */
function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("보관본 데이터베이스가 다른 탭에서 막혔다"));
  }).catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    // 쓰기는 트랜잭션이 끝나야 디스크에 남고, 용량 부족은 트랜잭션 오류로 온다.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("보관본 쓰기를 취소했다"));
  });
}

/**
 * 이 브라우저의 IndexedDB에 보관본을 둔다. 첨부 바이트(`Uint8Array`)를 구조화 복제로 그대로 담을 수 있고,
 * localStorage보다 용량이 커서 고른다. IndexedDB를 쓸 수 없는 브라우저(사생활 보호 모드 등)에서는 쓰기가 던지고
 * 자동 보관 실패로 보인다.
 */
export const browserDraftStorage: DraftStorage = {
  keys: async () => (await run("readonly", (store) => store.getAllKeys())).map(String),
  get: (key) => run<Draft | undefined>("readonly", (store) => store.get(key)),
  set: async (key, draft) => {
    await run("readwrite", (store) => store.put(draft, key));
  },
  delete: async (key) => {
    await run("readwrite", (store) => store.delete(key));
  },
};
