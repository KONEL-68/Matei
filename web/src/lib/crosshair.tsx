import { createContext, useContext, useState, useCallback, useId, useMemo, type ReactNode } from 'react';

interface CrosshairState {
  timestamp: number | null;
  sourceId: string | null;
}

interface CrosshairContextValue extends CrosshairState {
  setHover: (id: string, ts: number) => void;
  clearHover: (id: string) => void;
}

const CrosshairContext = createContext<CrosshairContextValue | null>(null);

export function CrosshairProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CrosshairState>({ timestamp: null, sourceId: null });

  const setHover = useCallback((id: string, ts: number) => {
    setState({ timestamp: ts, sourceId: id });
  }, []);

  const clearHover = useCallback((id: string) => {
    setState(prev => prev.sourceId === id ? { timestamp: null, sourceId: null } : prev);
  }, []);

  const value = useMemo(
    () => ({ ...state, setHover, clearHover }),
    [state, setHover, clearHover],
  );

  return (
    <CrosshairContext.Provider value={value}>
      {children}
    </CrosshairContext.Provider>
  );
}

/**
 * Hook for synchronized crosshair across charts.
 * Safe to call outside a CrosshairProvider — handlers become no-ops.
 *
 * Returns:
 * - onMouseMove / onMouseLeave: attach to Recharts chart element
 * - crosshairTs: timestamp to show as ReferenceLine, or null if this chart is the hover source
 */
export function useCrosshair() {
  const id = useId();
  const ctx = useContext(CrosshairContext);

  const onMouseMove = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chartState: any) => {
      if (ctx && chartState?.activeLabel != null) {
        ctx.setHover(id, Number(chartState.activeLabel));
      }
    },
    [ctx, id],
  );

  const onMouseLeave = useCallback(() => {
    ctx?.clearHover(id);
  }, [ctx, id]);

  const crosshairTs = ctx && ctx.sourceId !== null && ctx.sourceId !== id
    ? ctx.timestamp
    : null;

  return { onMouseMove, onMouseLeave, crosshairTs };
}
