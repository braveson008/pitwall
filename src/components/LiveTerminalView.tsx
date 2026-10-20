import { forwardRef, useCallback, useMemo, useSyncExternalStore, type ComponentProps } from "react";
import { terminalNotices } from "../lib/terminalStream";
import type { TerminalLinesStore } from "../terminal/terminalLinesStore";
import { AgentTerminalView, type AgentTerminalHandle } from "./AgentTerminalView";

type Props = Omit<ComponentProps<typeof AgentTerminalView>, "chunks"> & {
  store: TerminalLinesStore;
  /** Shown until the session has printed anything. */
  placeholder: string[];
  /** How many chunks this session's bounded buffer has dropped, read as it prints. */
  droppedFor?: (sessionId: string) => number;
};

/** A terminal pane that renders when its own session prints, and only then. */
export const LiveTerminalView = forwardRef<AgentTerminalHandle, Props>(function LiveTerminalView(
  { store, placeholder, sessionId, droppedFor, ...rest },
  ref,
) {
  const placeholderKey = placeholder.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fallback = useMemo(() => terminalNotices(placeholder), [placeholderKey]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(sessionId, listener), [store, sessionId]);
  const chunks = useSyncExternalStore(subscribe, () => store.get(sessionId) ?? fallback);
  return <AgentTerminalView ref={ref} sessionId={sessionId} chunks={chunks} {...rest} dropped={droppedFor?.(sessionId) ?? rest.dropped} />;
});

/** Every session's lines, for a view that shows several; silent while it is hidden. */
export function useAllTerminalLines(store: TerminalLinesStore, active: boolean) {
  const subscribe = useCallback(
    (listener: () => void) => (active ? store.subscribeAll(listener) : () => {}),
    [store, active],
  );
  return useSyncExternalStore(subscribe, store.getAll);
}
