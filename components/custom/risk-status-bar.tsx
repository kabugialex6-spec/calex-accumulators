'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DailyRiskLimit } from '@/hooks/use-daily-risk-limit';

interface RiskStatusBarProps {
  risk: DailyRiskLimit;
}

export function RiskStatusBar({ risk }: RiskStatusBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(risk.limit));

  const pnlPositive = risk.todayPnl >= 0;

  return (
    <Card className={cn(risk.isLocked && 'border-destructive')}>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Today&apos;s P&amp;L</span>
          <span
            className={cn(
              'font-mono font-semibold',
              pnlPositive ? 'text-emerald-600' : 'text-orange-600'
            )}
          >
            {pnlPositive ? '+' : ''}
            {risk.todayPnl.toFixed(2)} USD
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Trades today</span>
          <span className="font-mono text-foreground">{risk.todayTradeCount}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-muted-foreground">Daily loss limit</span>
          {editing ? (
            <>
              <Input
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-7 w-20 text-xs"
                min={1}
                step={1}
                autoFocus
              />
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const n = parseFloat(draft);
                  if (n > 0) risk.setLimit(n);
                  setEditing(false);
                }}
              >
                Save
              </Button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(String(risk.limit));
                setEditing(true);
              }}
              className="font-mono text-foreground underline decoration-dotted underline-offset-2"
            >
              ${risk.limit.toFixed(0)}
            </button>
          )}
        </div>
        {risk.isLocked && (
          <div className="w-full rounded-md bg-destructive/10 px-3 py-2 font-medium text-destructive">
            Daily loss limit reached — trading locked until tomorrow. This is here to protect you,
            not to get in your way.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
