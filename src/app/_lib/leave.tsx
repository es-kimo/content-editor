"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";

import { ConfirmDialog } from "@/app/_lib/confirm-dialog";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 이탈 확인만 가져온다.
import { createLeaveGuard, traverseNeedsConfirm, type LeaveGuard } from "@/lib/content/leave-guard";
import { areaNames, type EditArea } from "@/lib/content/unsaved";

const LeaveGuardContext = createContext<LeaveGuard | null>(null);

// TypeScript의 DOM 타입에 아직 Navigation API가 없어 쓰는 것만 적는다.
type BrowserNavigation = EventTarget & { traverseTo(key: string): unknown };
type NavigateEvent = Event & { navigationType: string; destination: { url: string; key: string } };

/** 뒤로·앞으로를 앱이 막을 수 있는 유일한 방법이 Navigation API다. 없는 브라우저에서는 확인하지 못한다. */
const browserNavigation = () => (window as Window & { navigation?: BrowserNavigation }).navigation;

/**
 * 같은 탭의 앱 안 이동(`LeaveLink`)과 브라우저 뒤로·앞으로 전에 미저장 입력을 잃는지 묻고,
 * 새로고침·탭 닫기·외부 이동에는 브라우저 기본 경고를 요청한다.
 * @param areas 지금 떠나면 사라지는 미저장 영역.
 * @param onDiscarded `변경 버리고 나가기`로 떠난 화면이 숨겨질 때 부른다. 입력을 버리는 일은 부르는 쪽이 한다.
 */
export function LeaveGuardProvider({
  areas,
  onDiscarded,
  children,
}: {
  areas: () => EditArea[];
  onDiscarded: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [guard] = useState(() =>
    createLeaveGuard({
      areas,
      go: (leave) => (leave.kind === "push" ? router.push(leave.href) : browserNavigation()?.traverseTo(leave.key)),
    }),
  );
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => guard.arrived(), [guard, pathname, search]);
  // 떠난 화면은 언마운트되지 않고 숨겨지며 그때 layout effect가 정리된다. 숨겨진 화면은 effect를 다시 돌리지 않아
  // `arrived` 전이라 나가기를 골랐는지 알 수 있고, 이동을 마친 뒤라 버린 입력이 처음 상태로 바뀌는 모습도 보이지 않는다.
  useLayoutEffect(
    () => () => {
      if (guard.discarding()) onDiscarded();
    },
    [guard, onDiscarded],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!guard.warnsUnload()) return;
      event.preventDefault();
      // preventDefault만으로는 경고하지 않는 브라우저가 있다.
      event.returnValue = "";
    };
    const traverse = (event: Event) => {
      const { navigationType, destination, cancelable } = event as NavigateEvent;
      if (navigationType !== "traverse") return;
      if (!traverseNeedsConfirm({ from: window.location.href, to: destination.url, cancelable })) return;
      if (!guard.request({ kind: "traverse", key: destination.key })) event.preventDefault();
    };
    const navigation = browserNavigation();
    window.addEventListener("beforeunload", warn);
    navigation?.addEventListener("navigate", traverse);
    return () => {
      window.removeEventListener("beforeunload", warn);
      navigation?.removeEventListener("navigate", traverse);
    };
  }, [guard]);

  const { pending, areas: lost } = useSyncExternalStore(guard.subscribe, guard.getState, guard.getState);
  return (
    <LeaveGuardContext value={guard}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title="저장하지 않은 변경이 있어요. 나가면 입력이 사라져요."
        confirmLabel="변경 버리고 나가기"
        onKeep={() => guard.stay()}
        onConfirm={() => guard.leave()}
      >
        <p className="text-sm">바뀐 곳: {areaNames(lost).join(", ")}</p>
      </ConfirmDialog>
    </LeaveGuardContext>
  );
}

/**
 * 입력을 잃을 수 있는 같은 탭 이동 링크. `LeaveGuardProvider` 밖에서는 보통 링크다.
 * 새 탭 열기(Ctrl/Cmd+클릭 등)는 Next.js가 `onNavigate`를 부르지 않아 묻지 않는다.
 */
export function LeaveLink({
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  const guard = useContext(LeaveGuardContext);
  return (
    <Link
      href={href}
      onNavigate={(event) => {
        if (guard && !guard.request({ kind: "push", href })) event.preventDefault();
      }}
      {...props}
    />
  );
}
