import { Suspense, type ReactNode } from "react";

/** 주 버튼. `<a>`와 `<button>`에 같이 쓴다. */
export const PRIMARY_BUTTON_CLASS =
  "w-fit rounded bg-black px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black";

/** 화면 셸. `header`는 불러오는 동안에도 보이고, `children`은 불러오는 동안 로딩 안내로 대신한다. */
export function PageShell({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
      {header}
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>{children}</Suspense>
    </main>
  );
}
