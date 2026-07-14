'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AccumulatorProposalInfo } from '@/hooks/use-accumulator-proposal';

interface MarketConditionsPanelProps {
  prices: number[];
  proposal: AccumulatorProposalInfo | null;
}

function computeVolatilityPct(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] === 0) continue;
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

function computeStreak(prices: number[]): { count: number; direction: 'up' | 'down' | 'flat' } {
  if (prices.length < 2) return { count: 0, direction: 'flat' };
  const lastDiff = prices[prices.length - 1] - prices[prices.length - 2];
  const direction: 'up' | 'down' | 'flat' = lastDiff > 0 ? 'up' : lastDiff < 0 ? 'down' : 'flat';
  let count = direction === 'flat' ? 0 : 1;
  for (let i = prices.length - 2; i > 0; i--) {
    const diff = prices[i] - prices[i - 1];
    const dir: 'up' | 'down' | 'flat' = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    if (dir === direction && dir !== 'flat') count++;
    else break;
  }
  return { count, direction };
}

/**
 * Purely informational readout of recent price behavior — realized
 * volatility, tick-direction streak, and current barrier distance. This is
 * NOT a buy/sell signal: Deriv's synthetic indices run at a fixed, engineered
 * volatility, so recent calm or choppy stretches don't forecast what happens
 * next. It exists to help you see current conditions at a glance, not to
 * tell you when to trade.
 */
export function MarketConditionsPanel({ prices, proposal }: MarketConditionsPanelProps) {
  const recentPrices = useMemo(() => prices.slice(-30), [prices]);
  const volatility = useMemo(() => computeVolatilityPct(recentPrices), [recentPrices]);
  const streak = useMemo(() => computeStreak(recentPrices), [recentPrices]);

  const calmness =
    volatility < 0.02
      ? { label: 'Calm', cls: 'text-emerald-600 border-emerald-500/40' }
      : volatility < 0.05
        ? { label: 'Normal', cls: 'text-amber-600 border-amber-500/40' }
        : { label: 'Choppy', cls: 'text-orange-600 border-orange-500/40' };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Market conditions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Volatility (last 30 ticks)</span>
          <Badge variant="outline" className={cn(calmness.cls)}>
            {calmness.label} ({volatility.toFixed(3)}%)
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Tick streak</span>
          <span className="font-mono text-foreground">
            {streak.count > 0 ? `${streak.count}× ${streak.direction}` : '—'}
          </span>
        </div>
        {proposal && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Barrier distance</span>
            <span className="font-mono text-foreground">{proposal.barrierPercentage}</span>
          </div>
        )}
        <p className="pt-1 leading-relaxed text-muted-foreground">
          Informational only, not a signal. This instrument runs at a fixed, engineered volatility,
          so recent conditions don&apos;t forecast what comes next.
        </p>
      </CardContent>
    </Card>
  );
}
