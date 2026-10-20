"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 미저장 판정만 가져온다.
import { unsavedAreas, type EditArea } from "@/lib/content/unsaved";

type Changed = { [area in EditArea]?: boolean };

const UnsavedContext = createContext<{ changed: Changed; report: (area: EditArea, changed: boolean) => void } | null>(
  null,
);

/** 화면의 편집 영역들이 알린 미저장 변경을 모은다. 숨긴 편집기도 띄워 둔 채라 계속 알린다. */
export function UnsavedProvider({ children }: { children: ReactNode }) {
  const [changed, setChanged] = useState<Changed>({});
  const report = useCallback((area: EditArea, next: boolean) => {
    setChanged((prev) => (Boolean(prev[area]) === next ? prev : { ...prev, [area]: next }));
  }, []);
  const value = useMemo(() => ({ changed, report }), [changed, report]);
  return <UnsavedContext value={value}>{children}</UnsavedContext>;
}

/** 편집 영역의 미저장 여부를 화면에 알린다. 영역이 사라지면 변경도 거둔다. */
export function useReportUnsaved(area: EditArea, changed: boolean) {
  const report = useContext(UnsavedContext)?.report;
  useEffect(() => {
    if (!report) return;
    report(area, changed);
    return () => report(area, false);
  }, [report, area, changed]);
}

/** 바뀐 영역이 있으면 색만이 아니라 문구와 영역 이름으로 알린다. */
export function UnsavedNotice() {
  const changed = useContext(UnsavedContext)?.changed ?? {};
  const areas = unsavedAreas(changed);
  if (areas.length === 0) return null;
  return <p className="text-sm text-amber-600">저장하지 않은 변경이 있다. 바뀐 영역: {areas.join(", ")}</p>;
}
