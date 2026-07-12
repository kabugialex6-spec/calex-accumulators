'use client';

import { useEffect, useRef, useState } from 'react';
import { DerivWS } from '@deriv/core';
import type { Tick, TicksHistoryResponse } from '@deriv/core';

export interface MarketDigitStats {
  symbol: string;
  lastPrice: number | null;
  pipSize: number;
  digits: number[];
  pct: number[];
  dev: number[];
  hottest: number;
  coldest: number;
  streak: number;
  lastDigit: number | null;
  sampleSize: number;
}

export interface PatternEvent {
  id: number;
  time: string;
  symbol: string;
  type: 'cold' | 'hot';
  digit: number;
  deviation: number;
  result: 'PENDING' | 'HIT' | 'MISS';
}

// After a cold/hot digit is logged, we watch this many further ticks to see
// whether that same digit actually reappears — a plain empirical check, not
// a trade outcome (this panel never places trades).
const LOOKAHEAD_TICKS = 5;
const SETTLE_BUFFER = 40;
// Ticks to wait before the same symbol can log another event, so the log
// doesn't flood while a market sits above threshold.
const EVENT_COOLDOWN_TICKS = 10;

function lastDigitOf(quote: number, pipSize: number): number {
  const s = quote.toFixed(pipSize);
  return Number(s[s.length - 1]);
}

function statsFromDigits(
  symbol: string,
  digits: number[],
  lastPrice: number | null,
  pipSize: number
): MarketDigitStats {
  const counts = new Array(10).fill(0);
  digits.forEach((d) => counts[d]++);
  const total = digits.length || 1;
  const pct = counts.map((c) => (c / total) * 100);
  const dev = pct.map((p) => p - 10);
  let hottest = 0;
  let coldest = 0;
  dev.forEach((v, i) => {
    if (v > dev[hottest]) hottest = i;
    if (v < dev[coldest]) coldest = i;
  });
  let streak = digits.length ? 1 : 0;
  for (let i = digits.length - 1; i > 0; i--) {
    if (digits[i] === digits[i - 1]) streak++;
    else break;
  }
  return {
    symbol,
    lastPrice,
    pipSize,
    digits,
    pct,
    dev,
    hottest,
    coldest,
    streak,
    lastDigit: digits.length ? digits[digits.length - 1] : null,
    sampleSize: digits.length,
  };
}

/**
 * Tracks live last-digit frequency across one or more synthetic index
 * symbols, on its own public (unauthenticated) WebSocket connection —
 * deliberately isolated from useDerivWSContext so this analytics panel can
 * never interfere with an in-flight authenticated trade on the main WS.
 *
 * Read-only: this hook never sends a buy request. It surfaces frequency
 * deviation as information, and separately logs whether a flagged digit
 * empirically reappeared within a short lookahead window.
 */
export function useDigitPulse(symbols: string[], windowSize: number, thresholdPct: number) {
  const [statsBySymbol, setStatsBySymbol] = useState<Record<string, MarketDigitStats>>({});
  const [events, setEvents] = useState<PatternEvent[]>([]);
  const [connected, setConnected] = useState(false);

  const symbolsKey = symbols.join(',');

  useEffect(() => {
    const ws = new DerivWS();
    const unsubs: (() => void)[] = [];
    let disposed = false;

    const digitsBySymbol: Record<string, number[]> = {};
    const pipSizeBySymbol: Record<string, number> = {};
    const tickIdxBySymbol: Record<string, number> = {};
    const settleBufBySymbol: Record<string, { idx: number; digit: number }[]> = {};
    const lastEventAt: Record<string, number> = {};
    let pending: { eventId: number; symbol: string; targetIdx: number; digit: number }[] = [];
    let eventIdCounter = 0;

    const offConn = ws.onConnectionStateChange(setConnected);
    unsubs.push(offConn);

    async function run() {
      try {
        await ws.connect();
      } catch {
        return;
      }
      if (disposed) return;

      for (const symbol of symbols) {
        digitsBySymbol[symbol] = [];
        settleBufBySymbol[symbol] = [];
        tickIdxBySymbol[symbol] = 0;

        try {
          const history = await ws.send<TicksHistoryResponse & { pip_size?: number }>({
            ticks_history: symbol,
            end: 'latest',
            start: 1,
            count: windowSize,
            style: 'ticks',
          });
          if (disposed) return;

          const pipSize = history.pip_size ?? 4;
          pipSizeBySymbol[symbol] = pipSize;
          const prices = history.history?.prices ?? [];
          const digits = prices.map((p) => lastDigitOf(p, pipSize));
          digitsBySymbol[symbol] = digits;
          tickIdxBySymbol[symbol] = digits.length;
          const lastPrice = prices.length ? prices[prices.length - 1] : null;

          setStatsBySymbol((prev) => ({
            ...prev,
            [symbol]: statsFromDigits(symbol, digits, lastPrice, pipSize),
          }));

          const sub = await ws.subscribe({ ticks: symbol }, (data) => {
            const tick = (data as { tick?: Tick }).tick;
            if (!tick) return;

            const ps = tick.pip_size ?? pipSizeBySymbol[symbol] ?? pipSize;
            pipSizeBySymbol[symbol] = ps;
            const d = lastDigitOf(tick.quote, ps);

            const arr = digitsBySymbol[symbol];
            arr.push(d);
            if (arr.length > windowSize) arr.shift();

            tickIdxBySymbol[symbol] += 1;
            const idx = tickIdxBySymbol[symbol];
            const buf = settleBufBySymbol[symbol];
            buf.push({ idx, digit: d });
            if (buf.length > SETTLE_BUFFER) buf.shift();

            const s = statsFromDigits(symbol, [...arr], tick.quote, ps);
            setStatsBySymbol((prev) => ({ ...prev, [symbol]: s }));

            const maxDev = Math.max(s.dev[s.hottest], Math.abs(s.dev[s.coldest]));
            const sinceLastEvent = idx - (lastEventAt[symbol] ?? -Infinity);
            if (maxDev >= thresholdPct && sinceLastEvent > EVENT_COOLDOWN_TICKS) {
              lastEventAt[symbol] = idx;
              const isCold = Math.abs(s.dev[s.coldest]) >= s.dev[s.hottest];
              const digit = isCold ? s.coldest : s.hottest;
              const deviation = isCold ? s.dev[s.coldest] : s.dev[s.hottest];
              const eventId = ++eventIdCounter;
              pending.push({ eventId, symbol, targetIdx: idx + LOOKAHEAD_TICKS, digit });
              setEvents((prev) =>
                [
                  {
                    id: eventId,
                    time: new Date().toLocaleTimeString(),
                    symbol,
                    type: (isCold ? 'cold' : 'hot') as 'cold' | 'hot',
                    digit,
                    deviation,
                    result: 'PENDING' as const,
                  },
                  ...prev,
                ].slice(0, 30)
              );
            }

            pending = pending.filter((p) => {
              if (p.symbol !== symbol || idx < p.targetIdx) return true;
              const hit = buf.find((x) => x.idx === p.targetIdx);
              if (hit) {
                const result = hit.digit === p.digit ? 'HIT' : 'MISS';
                setEvents((prev) => prev.map((e) => (e.id === p.eventId ? { ...e, result } : e)));
              }
              return false;
            });
          });

          if (disposed) {
            sub.unsubscribe();
          } else {
            unsubs.push(sub.unsubscribe);
          }
        } catch {
          // One symbol failing to subscribe shouldn't take down the others.
        }
      }
    }

    run();

    return () => {
      disposed = true;
      unsubs.forEach((fn) => fn());
      ws.disconnect();
    };
    // windowSize/thresholdPct changes intentionally re-run the whole effect
    // (fresh history refetch) rather than patching state in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, windowSize, thresholdPct]);

  return { statsBySymbol, events, connected };
}
