'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SYMBOL_DISPLAY_NAMES } from '@/lib/active-symbols-display-names';
import { useDigitPulse } from '@/hooks/use-digit-pulse';

const AVAILABLE_MARKETS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100',
  '1HZ10V',
  '1HZ25V',
  '1HZ50V',
  '1HZ75V',
  '1HZ100V',
];

const DEFAULT_MARKETS = ['R_10', 'R_25', 'R_50', 'R_100', '1HZ10V'];
const WINDOW_OPTIONS = [100, 250, 500, 1000];
const THRESHOLD_OPTIONS = [2, 3, 4, 6];

function marketName(symbol: string): string {
  return SYMBOL_DISPLAY_NAMES[symbol] ?? symbol;
}

export function DigitPulsePanel() {
  const [activeMarkets, setActiveMarkets] = useState<string[]>(DEFAULT_MARKETS);
  const [windowSize, setWindowSize] = useState(250);
  const [threshold, setThreshold] = useState(3);
  const [tapeSymbol, setTapeSymbol] = useState(DEFAULT_MARKETS[0]);

  const { statsBySymbol, events, connected } = useDigitPulse(activeMarkets, windowSize, threshold);

  const tapeDigits = useMemo(() => {
    const s = statsBySymbol[tapeSymbol];
    return s ? s.digits.slice(-60) : [];
  }, [statsBySymbol, tapeSymbol]);

  return (
    <div className="space-y-4">
      {/* status + controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            )}
          />
          <span className="text-sm text-muted-foreground">
            {connected ? `Live · ${activeMarkets.length} markets` : 'Connecting…'}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Window</span>
            <Select value={String(windowSize)} onValueChange={(v) => setWindowSize(Number(v))}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {w} ticks
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Threshold</span>
            <Select value={String(threshold)} onValueChange={(v) => setThreshold(Number(v))}>
              <SelectTrigger className="h-8 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THRESHOLD_OPTIONS.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    ±{t}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* market picker */}
      <ToggleGroup
        type="multiple"
        value={activeMarkets}
        onValueChange={(v) => {
          if (v.length > 0) setActiveMarkets(v);
        }}
        className="flex-wrap justify-start"
      >
        {AVAILABLE_MARKETS.map((symbol) => (
          <ToggleGroupItem key={symbol} value={symbol} size="sm" className="text-xs">
            {symbol}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* market grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {activeMarkets.map((symbol) => {
          const s = statsBySymbol[symbol];
          return (
            <Card key={symbol}>
              <CardHeader className="pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">{marketName(symbol)}</CardTitle>
                  <span className="font-mono text-sm text-muted-foreground">
                    {s?.lastPrice != null ? s.lastPrice.toFixed(s.pipSize) : '—'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex h-14 items-end gap-1">
                  {Array.from({ length: 10 }, (_, digit) => {
                    const pct = s?.pct[digit] ?? 0;
                    const dev = s?.dev[digit] ?? 0;
                    const isCold = dev <= -threshold;
                    const isHot = dev >= threshold;
                    return (
                      <div key={digit} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className={cn(
                            'w-full rounded-t transition-all',
                            isCold ? 'bg-emerald-500' : isHot ? 'bg-orange-500' : 'bg-muted-foreground/30'
                          )}
                          style={{ height: `${Math.max(3, pct * 4)}px` }}
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">{digit}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    streak{' '}
                    <b className="text-foreground">
                      {s?.streak ?? 0}×{s?.lastDigit ?? '–'}
                    </b>
                  </span>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
                    cold {s?.coldest ?? '–'} ({s ? s.dev[s.coldest].toFixed(1) : '0.0'}%)
                  </Badge>
                  <Badge variant="outline" className="border-orange-500/40 text-orange-600">
                    hot {s?.hottest ?? '–'} (+{s ? s.dev[s.hottest].toFixed(1) : '0.0'}%)
                  </Badge>
                  <span>n={s?.sampleSize ?? 0}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* tape */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-semibold">Digit tape</CardTitle>
          <Select value={tapeSymbol} onValueChange={setTapeSymbol}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeMarkets.map((symbol) => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {tapeDigits.map((d, i) => (
              <div
                key={i}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-muted/40 font-mono text-xs font-semibold"
              >
                {d}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* pattern log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Pattern log</CardTitle>
          <p className="text-xs text-muted-foreground">
            Logged automatically when a digit's frequency crosses your threshold. &quot;Result&quot;
            just checks whether that digit reappeared within the next {5} ticks — it is not a trade
            outcome, since this panel never places trades.
          </p>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Digit</TableHead>
                  <TableHead>Deviation</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                      No deviations past ±{threshold}% yet.
                    </TableCell>
                  </TableRow>
                )}
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.time}</TableCell>
                    <TableCell className="text-xs">{e.symbol}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.digit}{' '}
                      <span className={e.type === 'cold' ? 'text-emerald-600' : 'text-orange-600'}>
                        ({e.type})
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.deviation >= 0 ? '+' : ''}
                      {e.deviation.toFixed(1)}%
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-xs font-semibold',
                        e.result === 'HIT' && 'text-emerald-600',
                        e.result === 'MISS' && 'text-orange-600',
                        e.result === 'PENDING' && 'text-muted-foreground'
                      )}
                    >
                      {e.result}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Deriv&apos;s synthetic indices run on a certified RNG — each tick&apos;s last digit is
        drawn independently and uniformly, so a &quot;cold&quot; digit isn&apos;t statistically more
        likely to appear next. This panel is for observing patterns and checking that empirically,
        not a trading signal.
      </p>
    </div>
  );
}
