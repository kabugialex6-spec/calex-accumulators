'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ClosedPosition } from '@/lib/types';

const STORAGE_PREFIX = 'calex-daily-loss-limit';
export const DEFAULT_DAILY_LOSS_LIMIT = 25;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC calendar day
}

export interface DailyRiskLimit {
  limit: number;
  setLimit: (value: number) => void;
  /** Realized P&L today from actual closed trades. Negative = losing. */
  todayPnl: number;
  todayTradeCount: number;
  /** True once today's losses reach or exceed the limit. */
  isLocked: boolean;
  /** How much loss budget is left before lockout (never negative). */
  remaining: number;
}

/**
 * Tracks realized P&L for the current UTC day from the account's own closed
 * positions (real Deriv data, not a simulation) and exposes a lockout flag
 * once losses reach a configurable daily limit. Limit is persisted per
 * account in localStorage so it survives refreshes but never leaves the
 * browser.
 */
export function useDailyRiskLimit(
  closedPositions: ClosedPosition[],
  accountId: string | null
): DailyRiskLimit {
  const [limit, setLimitState] = useState<number>(DEFAULT_DAILY_LOSS_LIMIT);
  const storageKey = accountId ? `${STORAGE_PREFIX}:${accountId}` : null;

  useEffect(() => {
    if (!storageKey) return;
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      const n = parseFloat(saved);
      if (!Number.isNaN(n) && n > 0) setLimitState(n);
    }
  }, [storageKey]);

  const setLimit = useCallback(
    (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      setLimitState(value);
      if (storageKey) window.localStorage.setItem(storageKey, String(value));
    },
    [storageKey]
  );

  const { todayPnl, todayTradeCount } = useMemo(() => {
    const key = todayKey();
    let pnl = 0;
    let count = 0;
    for (const p of closedPositions) {
      const sellDay = new Date(p.sell_time * 1000).toISOString().slice(0, 10);
      if (sellDay !== key) continue;
      pnl += p.sell_price - p.buy_price;
      count += 1;
    }
    return { todayPnl: pnl, todayTradeCount: count };
  }, [closedPositions]);

  const isLocked = todayPnl <= -Math.abs(limit);
  const remaining = Math.max(0, limit + todayPnl);

  return { limit, setLimit, todayPnl, todayTradeCount, isLocked, remaining };
}
