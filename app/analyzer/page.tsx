'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// ---------- Types ----------
type Candle = { epoch: number; open: number; high: number; low: number; close: number };
type Zone = { price: number; touches: number; type: 'support' | 'resistance' };
type Pattern = { name: string; dir: 'bullish' | 'bearish' | 'neutral' };
type Trend = { dir: 'up' | 'down' | 'range' | 'unclear'; reason: string };
type Momentum = { dir: 'bullish' | 'bearish' | 'neutral' | 'unclear'; fast: number | null; slow: number | null };
type SignalResult = {
  signal: 'buy' | 'sell' | 'wait';
  reasonText: string;
  confidence: number;
  trend: Trend;
  nearZone: Zone | null;
  pattern: Pattern | null;
  momentum: Momentum;
};
type BacktestTrade = { i: number; signal: 'buy' | 'sell'; reason: string; confidence: number; movePct: number; outcome: 'win' | 'loss' | 'flat' };
type BacktestSummary = { total: number; buy: number; sell: number; winRate: string; wins: number; losses: number; flats: number };
type SymbolOption = { symbol: string; label: string; open: boolean };

const FALLBACK_SYMBOLS: SymbolOption[] = [
  { symbol: 'R_75', label: 'Volatility 75 Index', open: true },
  { symbol: 'R_100', label: 'Volatility 100 Index', open: true },
  { symbol: 'R_50', label: 'Volatility 50 Index', open: true },
  { symbol: 'R_25', label: 'Volatility 25 Index', open: true },
  { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index', open: true },
  { symbol: 'frxEURUSD', label: 'EUR/USD', open: true },
  { symbol: 'frxGBPUSD', label: 'GBP/USD', open: true },
];

// ---------- Pure analysis functions ----------
function findSwings(data: Candle[], lookback = 3) {
  const highs: { i: number; price: number }[] = [];
  const lows: { i: number; price: number }[] = [];
  for (let i = lookback; i < data.length - lookback; i++) {
    const window = data.slice(i - lookback, i + lookback + 1);
    if (data[i].high === Math.max(...window.map(c => c.high))) highs.push({ i, price: data[i].high });
    if (data[i].low === Math.min(...window.map(c => c.low))) lows.push({ i, price: data[i].low });
  }
  return { highs, lows };
}

function computeZones(data: Candle[]): Zone[] {
  const closed = data.slice(0, -1);
  if (closed.length < 10) return [];
  const { highs, lows } = findSwings(closed, 3);
  const price = data[data.length - 1].close;
  const tol = price * 0.004;

  function cluster(points: { i: number; price: number }[], type: 'support' | 'resistance'): Zone[] {
    const zones: Zone[] = [];
    points.forEach(p => {
      const zone = zones.find(z => Math.abs(z.price - p.price) < tol);
      if (zone) { zone.touches++; zone.price = (zone.price + p.price) / 2; }
      else zones.push({ price: p.price, touches: 1, type });
    });
    return zones.filter(z => z.touches >= 2);
  }
  return [...cluster(highs, 'resistance'), ...cluster(lows, 'support')];
}

function determineTrend(data: Candle[]): Trend {
  const closed = data.slice(0, -1);
  if (closed.length < 20) return { dir: 'unclear', reason: 'Not enough data yet' };
  const { highs, lows } = findSwings(closed.slice(-40), 3);
  if (highs.length < 2 || lows.length < 2) return { dir: 'unclear', reason: 'Not enough swing points yet' };
  const hUp = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const lUp = lows[lows.length - 1].price > lows[lows.length - 2].price;
  const hDown = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const lDown = lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (hUp && lUp) return { dir: 'up', reason: 'Higher highs and higher lows' };
  if (hDown && lDown) return { dir: 'down', reason: 'Lower highs and lower lows' };
  return { dir: 'range', reason: 'No consistent higher/lower structure' };
}

function detectPattern(data: Candle[]): Pattern | null {
  if (data.length < 3) return null;
  const c = data[data.length - 2];
  const p = data[data.length - 3];
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 1e-9;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const pBody = Math.abs(p.close - p.open);

  if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close && body > pBody)
    return { name: 'Bullish engulfing', dir: 'bullish' };
  if (p.close > p.open && c.close < c.open && c.open > p.close && c.close < p.open && body > pBody)
    return { name: 'Bearish engulfing', dir: 'bearish' };
  if (lowerWick > body * 2 && upperWick < body * 0.5 && body / range < 0.4)
    return { name: 'Hammer / pin bar', dir: 'bullish' };
  if (upperWick > body * 2 && lowerWick < body * 0.5 && body / range < 0.4)
    return { name: 'Shooting star / pin bar', dir: 'bearish' };
  if (body / range < 0.1)
    return { name: 'Doji (indecision)', dir: 'neutral' };
  return null;
}

function emaSeries(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function computeMomentum(data: Candle[]): Momentum {
  const closed = data.slice(0, -1).map(c => c.close);
  if (closed.length < 21) return { dir: 'unclear', fast: null, slow: null };
  const fastArr = emaSeries(closed, 9);
  const slowArr = emaSeries(closed, 21);
  const fast = fastArr[fastArr.length - 1];
  const slow = slowArr[slowArr.length - 1];
  if (fast == null || slow == null) return { dir: 'unclear', fast, slow };
  if (fast > slow) return { dir: 'bullish', fast, slow };
  if (fast < slow) return { dir: 'bearish', fast, slow };
  return { dir: 'neutral', fast, slow };
}

function computeSignalForData(data: Candle[]): SignalResult {
  const trend = determineTrend(data);
  const zones = computeZones(data);
  const pattern = detectPattern(data);
  const momentum = computeMomentum(data);
  const price = data[data.length - 1].close;
  const tol = price * 0.004;
  const nearZone = zones.find(z => Math.abs(z.price - price) < tol * 1.5) ?? null;

  const bullScore = (trend.dir === 'up' ? 1 : 0) + (nearZone?.type === 'support' ? 1 : 0) +
    (pattern?.dir === 'bullish' ? 1 : 0) + (momentum.dir === 'bullish' ? 1 : 0);
  const bearScore = (trend.dir === 'down' ? 1 : 0) + (nearZone?.type === 'resistance' ? 1 : 0) +
    (pattern?.dir === 'bearish' ? 1 : 0) + (momentum.dir === 'bearish' ? 1 : 0);

  let signal: 'buy' | 'sell' | 'wait' = 'wait';
  let confidence = Math.max(bullScore, bearScore);
  let reasonText = 'Conditions not aligned';

  if (bullScore >= 3 && bullScore > bearScore) {
    signal = 'buy'; confidence = bullScore;
    reasonText = `${confidence}/4 factors aligned bullish${pattern ? ` (${pattern.name})` : ''}`;
  } else if (bearScore >= 3 && bearScore > bullScore) {
    signal = 'sell'; confidence = bearScore;
    reasonText = `${confidence}/4 factors aligned bearish${pattern ? ` (${pattern.name})` : ''}`;
  }

  return { signal, reasonText, confidence, trend, nearZone, pattern, momentum };
}

function getDecimals(candles: Candle[]) {
  return candles[candles.length - 1].close < 10 ? 5 : 2;
}

function ChecklistItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="check-item">
      <div className={`check-icon ${ok ? 'yes' : 'no'}`}>{ok ? '\u2713' : '\u2013'}</div>
      <div>{children}</div>
    </div>
  );
}

// ---------- Page ----------
export default function AnalyzerPage() {
  const [symbols, setSymbols] = useState<SymbolOption[]>(FALLBACK_SYMBOLS);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [symbol, setSymbol] = useState('R_75');
  const [granularity, setGranularity] = useState(300);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState('Not connected');
  const [statusCls, setStatusCls] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [price, setPrice] = useState('\u2014');
  const [candleCountText, setCandleCountText] = useState('0 candles loaded');
  const [signalResult, setSignalResult] = useState<SignalResult | null>(null);
  const [pulse, setPulse] = useState(false);
  const [backtestSummary, setBacktestSummary] = useState<BacktestSummary | null>(null);
  const [backtestTrades, setBacktestTrades] = useState<BacktestTrade[] | null>(null);
  const [backtestMessage, setBacktestMessage] = useState<string | null>(
    'Connect and let some candles load first, then run the backtest.'
  );

  const wsRef = useRef<WebSocket | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastSignalRef = useRef<string | null>(null);
  const alertsEnabledRef = useRef(alertsEnabled);
  const symbolRef = useRef(symbol);
  useEffect(() => { alertsEnabledRef.current = alertsEnabled; }, [alertsEnabled]);
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  // Fetch the live, current symbol list from Deriv so the dropdown can never go stale.
  useEffect(() => {
    let cancelled = false;
    const lookupSocket = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    const timeout = setTimeout(() => { if (!cancelled) { setSymbolsLoading(false); lookupSocket.close(); } }, 8000);

    lookupSocket.onopen = () => {
      lookupSocket.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
    };
    lookupSocket.onmessage = (evt: MessageEvent) => {
      if (cancelled) return;
      const data = JSON.parse(evt.data);
      if (data.msg_type === 'active_symbols' && Array.isArray(data.active_symbols)) {
        const list: SymbolOption[] = data.active_symbols
          .filter((s: { market: string }) => s.market === 'synthetic_index' || s.market === 'forex')
          .map((s: { symbol: string; display_name: string; exchange_is_open: number }) => ({
            symbol: s.symbol, label: s.display_name, open: s.exchange_is_open === 1,
          }))
          .sort((a: SymbolOption, b: SymbolOption) => a.label.localeCompare(b.label));
        if (list.length) {
          setSymbols(list);
          if (!list.some(s => s.symbol === symbolRef.current)) setSymbol(list[0].symbol);
        }
        setSymbolsLoading(false);
        clearTimeout(timeout);
        lookupSocket.close();
      }
    };
    lookupSocket.onerror = () => { if (!cancelled) setSymbolsLoading(false); };

    return () => { cancelled = true; clearTimeout(timeout); lookupSocket.close(); };
  }, []);

  function log(msg: string) {
    setLogLines(prev => [...prev.slice(-6), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  function beep(freq: number) {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch { /* audio not available */ }
  }

  function fireAlert(signal: 'buy' | 'sell', reasonText: string) {
    if (!alertsEnabledRef.current) return;
    beep(signal === 'buy' ? 880 : 440);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`${signal.toUpperCase()} signal \u2014 ${symbolRef.current}`, { body: reasonText });
    }
    setPulse(true);
    setTimeout(() => setPulse(false), 600);
  }

  function drawChart(candles: Candle[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = 320;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const visible = candles.slice(-90);
    const highs = visible.map(c => c.high), lows = visible.map(c => c.low);
    const max = Math.max(...highs), min = Math.min(...lows);
    const pad = (max - min) * 0.08 || 1;
    const top = max + pad, bottom = min - pad;
    const scaleY = (v: number) => h - ((v - bottom) / (top - bottom)) * h;

    const candleW = w / visible.length;
    const zones = computeZones(candles);
    zones.forEach(z => {
      const y = scaleY(z.price);
      ctx.fillStyle = z.type === 'support' ? 'rgba(0,200,150,0.08)' : 'rgba(255,92,92,0.08)';
      ctx.fillRect(0, y - 6, w, 12);
      ctx.strokeStyle = z.type === 'support' ? 'rgba(0,200,150,0.4)' : 'rgba(255,92,92,0.4)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    visible.forEach((c, i) => {
      const x = i * candleW + candleW / 2;
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? '#00C896' : '#FF5C5C';
      ctx.fillStyle = up ? '#00C896' : '#FF5C5C';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, scaleY(c.high)); ctx.lineTo(x, scaleY(c.low));
      ctx.stroke();
      const bodyTop = scaleY(Math.max(c.open, c.close));
      const bodyBot = scaleY(Math.min(c.open, c.close));
      const bw = Math.max(candleW * 0.6, 1);
      ctx.fillRect(x - bw / 2, bodyTop, bw, Math.max(bodyBot - bodyTop, 1));
    });
  }

  function renderTick() {
    const candles = candlesRef.current;
    if (!candles.length) return;
    setPrice(candles[candles.length - 1].close.toFixed(getDecimals(candles)));
    setCandleCountText(`${candles.length} candles loaded`);
    drawChart(candles);

    const result = computeSignalForData(candles);
    setSignalResult(result);
    if ((result.signal === 'buy' || result.signal === 'sell') && result.signal !== lastSignalRef.current) {
      fireAlert(result.signal, result.reasonText);
    }
    lastSignalRef.current = result.signal;
  }

  function connect() {
    candlesRef.current = [];
    lastSignalRef.current = null;
    setSignalResult(null);

    if (alertsEnabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const socket = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    wsRef.current = socket;

    socket.onopen = () => {
      setStatusText('Connected \u2014 requesting history');
      setStatusCls('live');
      log(`Connected. Subscribing to ${symbol} @ ${granularity}s`);
      socket.send(JSON.stringify({
        ticks_history: symbol, style: 'candles', granularity, count: 200, end: 'latest', subscribe: 1,
      }));
      setConnected(true);
    };

    socket.onmessage = (evt: MessageEvent) => {
      const data = JSON.parse(evt.data);
      if (data.error) {
        log('Error: ' + data.error.message);
        setStatusText('Error: ' + data.error.message);
        setStatusCls('err');
        return;
      }
      if (data.msg_type === 'candles') {
        candlesRef.current = data.candles.map((c: { epoch: number; open: string; high: string; low: string; close: string }) => ({
          epoch: c.epoch, open: +c.open, high: +c.high, low: +c.low, close: +c.close,
        }));
        setStatusText('Live');
        setStatusCls('live');
        log(`Loaded ${candlesRef.current.length} candles`);
        renderTick();
      } else if (data.msg_type === 'ohlc') {
        const o = data.ohlc;
        const c: Candle = { epoch: o.open_time, open: +o.open, high: +o.high, low: +o.low, close: +o.close };
        const arr = candlesRef.current;
        const last = arr[arr.length - 1];
        if (last && last.epoch === c.epoch) arr[arr.length - 1] = c;
        else {
          arr.push(c);
          if (arr.length > 200) arr.shift();
        }
        renderTick();
      }
    };

    socket.onerror = () => { setStatusText('Connection error'); setStatusCls('err'); log('WebSocket error'); };
    socket.onclose = () => { setStatusText('Disconnected'); setStatusCls(''); setConnected(false); log('Disconnected'); };
  }

  function disconnect() { wsRef.current?.close(); }

  useEffect(() => () => { wsRef.current?.close(); }, []);

  function runBacktest() {
    const candles = candlesRef.current;
    const horizon = 10, threshold = 0.001;

    if (candles.length < 60) {
      setBacktestMessage(`Only ${candles.length} candles loaded \u2014 connect and wait for at least 60 before backtesting.`);
      setBacktestSummary(null);
      setBacktestTrades(null);
      return;
    }

    const trades: BacktestTrade[] = [];
    let prevSig: 'buy' | 'sell' | 'wait' = 'wait';
    const maxI = candles.length - 1 - horizon;

    for (let i = 30; i <= maxI; i++) {
      const slice = candles.slice(0, i + 2);
      const result = computeSignalForData(slice);
      if ((result.signal === 'buy' || result.signal === 'sell') && result.signal !== prevSig) {
        const entry = candles[i].close;
        const future = candles[i + horizon].close;
        const move = (future - entry) / entry;
        let outcome: 'win' | 'loss' | 'flat';
        if (result.signal === 'buy') outcome = move > threshold ? 'win' : move < -threshold ? 'loss' : 'flat';
        else outcome = move < -threshold ? 'win' : move > threshold ? 'loss' : 'flat';
        trades.push({ i, signal: result.signal, reason: result.reasonText, confidence: result.confidence, movePct: move * 100, outcome });
      }
      prevSig = result.signal;
    }

    if (!trades.length) {
      setBacktestMessage(`No signals fired across the ${candles.length} loaded candles. Try a different timeframe or let more history load.`);
      setBacktestSummary(null);
      setBacktestTrades(null);
      return;
    }

    const wins = trades.filter(t => t.outcome === 'win').length;
    const losses = trades.filter(t => t.outcome === 'loss').length;
    const flats = trades.filter(t => t.outcome === 'flat').length;
    const decided = wins + losses;
    const winRate = decided ? ((wins / decided) * 100).toFixed(0) : '\u2014';

    setBacktestSummary({
      total: trades.length,
      buy: trades.filter(t => t.signal === 'buy').length,
      sell: trades.filter(t => t.signal === 'sell').length,
      winRate, wins, losses, flats,
    });
    setBacktestTrades(trades.slice(-20).reverse());
    setBacktestMessage(null);
  }

  const cssVars: CSSProperties = {
    ['--bg' as string]: '#0B0E11', ['--card' as string]: '#12161C', ['--card2' as string]: '#161B22', ['--border' as string]: '#1F2530',
    ['--text' as string]: '#E4E7EB', ['--text2' as string]: '#8B93A1', ['--text3' as string]: '#586071',
    ['--buy' as string]: '#00C896', ['--buy-dim' as string]: '#0A3B32',
    ['--sell' as string]: '#FF5C5C', ['--sell-dim' as string]: '#3B1414',
    ['--wait' as string]: '#F0A83B', ['--wait-dim' as string]: '#3B2A0A',
  };

  const signal = signalResult?.signal ?? 'wait';
  const confidence = signalResult?.confidence ?? 0;

  return (
    <div className="analyzer-root" style={cssVars}>
      <div className="wrap">
        <h1>Trade analyzer</h1>
        <p className="sub">Rule-based signal scanner on live Deriv price data — trend, zones, candle patterns, and EMA momentum. Not a prediction. Verify every signal yourself before trading.</p>

        <div className="panel">
          <div className="controls">
            <div className="field">
              <label>Symbol {symbolsLoading ? '(loading live list\u2026)' : ''}</label>
              <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{ minWidth: 220 }}>
                {symbols.map(s => (
                  <option key={s.symbol} value={s.symbol}>{s.label}{s.open ? '' : ' (closed)'}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Timeframe</label>
              <select value={granularity} onChange={e => setGranularity(parseInt(e.target.value, 10))}>
                <option value={60}>1 minute</option>
                <option value={300}>5 minutes</option>
                <option value={900}>15 minutes</option>
                <option value={3600}>1 hour</option>
              </select>
            </div>
            <button className={connected ? 'stop' : ''} onClick={() => (connected ? disconnect() : connect())}>
              {connected ? 'Disconnect' : 'Connect'}
            </button>
            <div className="checkbox-field">
              <input type="checkbox" checked={alertsEnabled} onChange={e => setAlertsEnabled(e.target.checked)} id="alertsToggle" />
              <label htmlFor="alertsToggle">Sound + notification alerts</label>
            </div>
          </div>
          <div className="status-row">
            <div className={`dot ${statusCls}`} />
            <span>{statusText}</span>
          </div>
          <div className="log">
            {logLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>

        <div className="panel">
          <div className="price-row">
            <div>
              <div className="symbol-label">{symbol}</div>
              <div className="price">{price}</div>
            </div>
            <div className="symbol-label">{candleCountText}</div>
          </div>
          <canvas ref={canvasRef} height={320} />
        </div>

        <div className="panel">
          <div className="signal-panel">
            <div className={`signal-badge ${signal} ${pulse ? 'pulse' : ''}`}>
              <div className="label">{signal.toUpperCase()}</div>
              <div className="confidence">{confidence}/4</div>
              <div className="sub">{signalResult?.reasonText ?? 'No setup yet'}</div>
            </div>
            <div className="checklist">
              {signalResult && (
                <>
                  <ChecklistItem ok={signalResult.trend.dir === 'up' || signalResult.trend.dir === 'down'}>
                    Trend: <b>{signalResult.trend.dir}</b> — {signalResult.trend.reason}
                  </ChecklistItem>
                  <ChecklistItem ok={!!signalResult.nearZone}>
                    {signalResult.nearZone
                      ? <>Price at <b>{signalResult.nearZone.type}</b> zone ({signalResult.nearZone.touches} touches)</>
                      : 'Price not at a support/resistance zone'}
                  </ChecklistItem>
                  <ChecklistItem ok={!!signalResult.pattern}>
                    {signalResult.pattern ? <>Pattern: <b>{signalResult.pattern.name}</b></> : 'No candlestick pattern on last closed candle'}
                  </ChecklistItem>
                  <ChecklistItem ok={signalResult.momentum.dir === 'bullish' || signalResult.momentum.dir === 'bearish'}>
                    {signalResult.momentum.dir === 'unclear'
                      ? 'Momentum: not enough data yet'
                      : <>Momentum (EMA9/21): <b>{signalResult.momentum.dir}</b></>}
                  </ChecklistItem>
                </>
              )}
            </div>
          </div>
          <p className="note">Signal needs at least 3 of 4 factors agreeing: trend, a support/resistance zone, a candlestick pattern, and EMA momentum. The confidence score shows how many lined up. When a BUY or SELL first appears, you&apos;ll get a sound and a browser notification (if allowed).</p>
        </div>

        <div className="panel">
          <p className="panel-title">Backtest — how these rules would&apos;ve performed on the loaded history</p>
          <div className="controls" style={{ marginBottom: 10 }}>
            <button className="secondary" onClick={runBacktest}>Run backtest on loaded candles</button>
          </div>
          {backtestMessage && <p className="note">{backtestMessage}</p>}
          {backtestSummary && (
            <div className="bt-summary">
              <div className="bt-stat"><div className="n">{backtestSummary.total}</div><div className="l">Signals</div></div>
              <div className="bt-stat"><div className="n">{backtestSummary.buy} / {backtestSummary.sell}</div><div className="l">Buy / Sell</div></div>
              <div className="bt-stat"><div className="n" style={{ color: 'var(--buy)' }}>{backtestSummary.winRate}%</div><div className="l">Win rate (of decided)</div></div>
              <div className="bt-stat"><div className="n">{backtestSummary.wins}W {backtestSummary.losses}L {backtestSummary.flats}F</div><div className="l">Outcomes</div></div>
            </div>
          )}
          {backtestTrades && (
            <div className="bt-list">
              {backtestTrades.map((t, idx) => (
                <div className="bt-row" key={idx}>
                  <span className={`bt-tag ${t.signal}`}>{t.signal.toUpperCase()} {t.confidence}/4</span>
                  <span>{t.reason}</span>
                  <span className={`bt-outcome ${t.outcome}`}>{t.outcome.toUpperCase()} {t.movePct >= 0 ? '+' : ''}{t.movePct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          )}
          {backtestTrades && (
            <p className="note">Each trade is scored on price movement 10 candles after the signal, vs a ±0.1% threshold. Rough approximation — no spread, slippage, or stop-loss placement is modeled.</p>
          )}
        </div>
      </div>

      <style jsx>{`
        .analyzer-root { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; min-height: 100vh; }
        .wrap { max-width: 960px; margin: 0 auto; }
        h1 { font-size: 18px; font-weight: 500; margin: 0 0 4px; letter-spacing: 0.2px; }
        .sub { color: var(--text2); font-size: 13px; margin: 0 0 20px; }
        .panel { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
        .panel-title { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: var(--text); }
        .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
        .field { display: flex; flex-direction: column; gap: 4px; }
        .field label { font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; }
        input, select { background: var(--card2); border: 1px solid var(--border); color: var(--text); padding: 8px 10px; border-radius: 6px; font-size: 13px; font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
        select { min-width: 150px; }
        button { background: var(--buy); color: #04231C; border: none; padding: 9px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
        button.stop { background: var(--sell); color: #3B0A0A; }
        button.secondary { background: var(--card2); color: var(--text); border: 1px solid var(--border); }
        .checkbox-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); padding-bottom: 8px; }
        .checkbox-field input { padding: 0; width: 14px; height: 14px; }
        .status-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 12px; color: var(--text2); font-family: monospace; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text3); }
        .dot.live { background: var(--buy); box-shadow: 0 0 6px var(--buy); }
        .dot.err { background: var(--sell); }
        canvas { width: 100%; display: block; border-radius: 8px; }
        .price-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
        .price { font-family: monospace; font-size: 24px; font-weight: 600; }
        .symbol-label { font-size: 12px; color: var(--text2); font-family: monospace; }
        .signal-panel { display: flex; gap: 16px; align-items: stretch; }
        .signal-badge { flex: 0 0 150px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 16px 8px; transition: transform 0.15s; }
        .signal-badge.pulse { animation: pulse 0.6s ease; }
        @keyframes pulse { 0% { transform: scale(1); } 30% { transform: scale(1.06); } 100% { transform: scale(1); } }
        .signal-badge.buy { background: var(--buy-dim); border: 1px solid var(--buy); }
        .signal-badge.sell { background: var(--sell-dim); border: 1px solid var(--sell); }
        .signal-badge.wait { background: var(--wait-dim); border: 1px solid var(--wait); }
        .signal-badge .label { font-size: 16px; font-weight: 700; letter-spacing: 0.5px; }
        .signal-badge .confidence { font-size: 11px; font-family: monospace; opacity: 0.8; }
        .signal-badge.buy .label { color: var(--buy); }
        .signal-badge.sell .label { color: var(--sell); }
        .signal-badge.wait .label { color: var(--wait); }
        .signal-badge .sub { font-size: 10px; color: var(--text2); text-transform: uppercase; text-align: center; margin-top: 2px; }
        .checklist { flex: 1; display: flex; flex-direction: column; gap: 8px; justify-content: center; }
        .log { font-family: monospace; font-size: 11px; color: var(--text3); max-height: 80px; overflow-y: auto; margin-top: 10px; }
        .note { font-size: 11px; color: var(--text3); line-height: 1.6; margin-top: 4px; }
        .bt-summary { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 14px; }
        .bt-stat { display: flex; flex-direction: column; gap: 2px; }
        .bt-stat .n { font-family: monospace; font-size: 20px; font-weight: 600; }
        .bt-stat .l { font-size: 10px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; }
        .bt-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
        .bt-row { display: flex; align-items: center; gap: 10px; font-size: 12px; font-family: monospace; padding: 6px 8px; background: var(--card2); border-radius: 6px; }
        .bt-tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; white-space: nowrap; }
        .bt-tag.buy { background: var(--buy-dim); color: var(--buy); }
        .bt-tag.sell { background: var(--sell-dim); color: var(--sell); }
        .bt-outcome { margin-left: auto; font-weight: 700; white-space: nowrap; }
        .bt-outcome.win { color: var(--buy); }
        .bt-outcome.loss { color: var(--sell); }
        .bt-outcome.flat { color: var(--text3); }
        .check-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text2); }
        .check-icon { width: 18px; height: 18px; border-radius: 5px; flex: 0 0 18px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
        .check-icon.yes { background: var(--buy-dim); color: var(--buy); }
        .check-icon.no { background: var(--card2); color: var(--text3); border: 1px solid var(--border); }
      `}</style>
    </div>
  );
}
