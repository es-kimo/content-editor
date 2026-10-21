import { Suspense, type ReactNode } from "react";

/** 주 버튼. `<a>`와 `<button>`에 같이 쓴다. */
export const PRIMARY_BUTTON_CLASS =
  "w-fit rounded bg-black px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black";

/** 보조 버튼. 테두리만 둔다. */
export const SECONDARY_BUTTON_CLASS = "w-fit rounded border px-4 py-2 disabled:opacity-60";

/**
 * 기본으로 접어 두는 기술 상세. 파일 경로·SHA·커밋 식별자·API 측정처럼 사용자의 작업에 필요하지 않은 정보를 모은다.
 * 사용자가 알아야 할 결과는 기본 화면에 두고 여기에는 그 기술 원문만 덧붙인다.
 */
export function TechDetails({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <details className="text-xs text-zinc-500">
      <summary className="cursor-pointer">기술 상세</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** 화면 셸. `header`는 불러오는 동안에도 보이고, `children`은 불러오는 동안 로딩 안내로 대신한다. */
export function PageShell({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
      {header}
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>{children}</Suspense>
    </main>
  );
}
