const btn = document.getElementById('checkBtn');
const tickerInput = document.getElementById('ticker');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const verdictEl = document.getElementById('verdict');
const asofEl = document.getElementById('asof');
const metricsEl = document.getElementById('metrics');
const reasonsEl = document.getElementById('reasons');
const markersEl = document.getElementById('indicator-markers');
const activityLogEl = document.getElementById('activity-log');

let priceChart = null;
let rsiChart = null;

function nowStamp() {
  return new Date().toLocaleTimeString();
}

function clearLog() {
  if (!activityLogEl) return;
  activityLogEl.textContent = '';
}

function logStep(message) {
  if (!activityLogEl) return;
  activityLogEl.textContent += `[${nowStamp()}] ${message}\n`;
  activityLogEl.scrollTop = activityLogEl.scrollHeight;
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i += 1) sum += values[i];
  return sum / period;
}

function pctChange(values, period) {
  if (values.length <= period) return null;
  const now = values[values.length - 1];
  const prev = values[values.length - 1 - period];
  if (!prev) return null;
  return (now / prev) - 1;
}

function rollingStdAnnualized(values, period) {
  if (values.length <= period) return null;
  const rets = [];
  for (let i = values.length - period; i < values.length; i += 1) {
    const p0 = values[i - 1];
    const p1 = values[i];
    if (!p0) continue;
    rets.push((p1 / p0) - 1);
  }
  if (!rets.length) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varSum = rets.reduce((a, b) => a + ((b - mean) ** 2), 0) / rets.length;
  return Math.sqrt(varSum) * Math.sqrt(252);
}

function rsi14(values) {
  if (values.length < 15) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - 14; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function smaSeries(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < period) out.push(null);
    else {
      let sum = 0;
      for (let j = i + 1 - period; j <= i; j += 1) sum += values[j];
      out.push(sum / period);
    }
  }
  return out;
}

function rsiSeries(values, period = 14) {
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i += 1) {
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const change = values[j] - values[j - 1];
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) out[i] = 100;
    else {
      const rs = avgGain / avgLoss;
      out[i] = 100 - (100 / (1 + rs));
    }
  }
  return out;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 3) throw new Error('Not enough market data returned.');
  const rows = lines.slice(1).map((line) => line.split(','));
  return rows
    .map((r) => ({
      date: r[0],
      open: safeNum(r[1]),
      high: safeNum(r[2]),
      low: safeNum(r[3]),
      close: safeNum(r[4]),
      volume: safeNum(r[5]),
    }))
    .filter((r) => r.close > 0);
}

function parseCsvLenient(text) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (normalized.length < 3) return [];
  const lines = normalized.map((line) => line.replace(/;+/g, ','));
  try {
    return parseCsv(lines.join('\n'));
  } catch (_) {
    // Fallback for wrapped proxy responses (for example r.jina.ai) that embed CSV lines in extra text.
    const extracted = [];
    for (const line of lines) {
      const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*$/);
      if (!m) continue;
      extracted.push({
        date: m[1],
        open: safeNum(m[2]),
        high: safeNum(m[3]),
        low: safeNum(m[4]),
        close: safeNum(m[5]),
        volume: safeNum(m[6]),
      });
    }
    return extracted.filter((r) => r.close > 0);
  }
}

function parseYahooChart(json) {
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0] || {};
  const closes = q.close || [];
  const opens = q.open || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const volumes = q.volume || [];

  const rows = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = safeNum(closes[i], NaN);
    if (!Number.isFinite(close) || close <= 0) continue;
    rows.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open: safeNum(opens[i]),
      high: safeNum(highs[i]),
      low: safeNum(lows[i]),
      close,
      volume: safeNum(volumes[i]),
    });
  }
  return rows;
}

async function tryFetchText(url) {
  logStep(`Trying text source: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  logStep(`Text source OK: ${url}`);
  return res.text();
}

async function tryFetchJson(url) {
  logStep(`Trying JSON source: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  logStep(`JSON source OK: ${url}`);
  return res.json();
}

async function fetchRowsWithFallback(ticker) {
  logStep(`Starting data pull for ${ticker}`);
  const t = ticker.toLowerCase();
  const stooqSymbols = [
    `${t}.us`,
    t,
  ];
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;

  const textAttempts = [];
  for (const sym of stooqSymbols) {
    const stooqUrl = `https://stooq.com/q/d/l/?s=${sym}&i=d`;
    textAttempts.push(
      stooqUrl,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(stooqUrl)}`,
      `https://cors.isomorphic-git.org/${stooqUrl}`,
      `https://r.jina.ai/http://stooq.com/q/d/l/?s=${sym}&i=d`,
    );
  }

  for (const attempt of textAttempts) {
    try {
      const text = await tryFetchText(attempt);
      let rows = [];
      try {
        rows = parseCsv(text);
      } catch (_) {
        logStep('Strict CSV parse failed, trying lenient parser.');
        rows = parseCsvLenient(text);
      }
      if (rows.length >= 60) {
        logStep(`Using text source with ${rows.length} rows.`);
        return rows;
      }
      logStep(`Source returned only ${rows.length} rows; continuing.`);
    } catch (err) {
      logStep(`Text source failed: ${attempt} (${err?.message || 'unknown error'})`);
    }
  }

  const jsonAttempts = [
    yahooUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://cors.isomorphic-git.org/${yahooUrl}`,
  ];

  for (const attempt of jsonAttempts) {
    try {
      const data = await tryFetchJson(attempt);
      const rows = parseYahooChart(data);
      if (rows.length >= 60) {
        logStep(`Using JSON source with ${rows.length} rows.`);
        return rows;
      }
      logStep(`JSON source returned only ${rows.length} rows; continuing.`);
    } catch (err) {
      logStep(`JSON source failed: ${attempt} (${err?.message || 'unknown error'})`);
    }
  }

  logStep('All market data sources failed.');
  throw new Error('Could not fetch market data right now. Please try a different ticker or try again shortly.');
}

function computeMetrics(rows) {
  if (rows.length < 60) throw new Error('Need at least 60 daily bars for a stable reading.');
  const closes = rows.map((r) => r.close);
  const vols = rows.map((r) => r.volume);
  const last = rows[rows.length - 1];

  const price = last.close;
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r5 = pctChange(closes, 5);
  const r20 = pctChange(closes, 20);
  const vol20 = rollingStdAnnualized(closes, 20);
  const rsi = rsi14(closes);
  const volAvg20 = sma(vols, 20);
  const volRatio = volAvg20 ? (last.volume / volAvg20) : null;

  const checks = [
    { name: 'Price > SMA20', pass: price > s20, reason: 'Price is above 20-day trend' },
    { name: 'SMA20 > SMA50', pass: s20 > s50, reason: 'Short trend is above medium trend' },
    { name: '20D Return > 0', pass: r20 > 0, reason: '20-day momentum is positive' },
    { name: 'RSI in 45-70', pass: rsi >= 45 && rsi <= 70, reason: 'RSI is in a constructive range' },
    { name: 'Volatility < 0.45', pass: vol20 < 0.45, reason: 'Volatility is moderate' },
  ];
  const score = checks.filter((c) => c.pass).length;
  const reasons = checks.filter((c) => c.pass).map((c) => c.reason);

  let verdict = 'HIGH RISK';
  let verdictColor = '#dc2626';
  if (score >= 4) {
    verdict = 'GOOD PICK';
    verdictColor = '#16a34a';
  } else if (score === 3) {
    verdict = 'WATCHLIST';
    verdictColor = '#d97706';
  }

  return {
    lastTimestamp: last.date,
    price,
    change5dPct: r5 * 100,
    change20dPct: r20 * 100,
    sma20: s20,
    sma50: s50,
    rsi14: rsi,
    vol20Annualized: vol20,
    volumeVs20d: volRatio,
    score,
    maxScore: 5,
    verdict,
    verdictColor,
    reasons,
    checks,
  };
}

function metricCard(label, value) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
  return div;
}

function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function renderIndicatorMarkers(checks) {
  markersEl.innerHTML = '';
  checks.forEach((c) => {
    const div = document.createElement('div');
    div.className = `marker ${c.pass ? 'pass' : 'fail'}`;
    div.textContent = `${c.pass ? 'PASS' : 'FAIL'}: ${c.name}`;
    markersEl.appendChild(div);
  });
}

function renderCharts(rows) {
  if (typeof Chart === 'undefined') return;
  const labels = rows.map((r) => r.date);
  const closes = rows.map((r) => r.close);
  const s20 = smaSeries(closes, 20);
  const s50 = smaSeries(closes, 50);
  const rsi = rsiSeries(closes, 14);

  if (priceChart) priceChart.destroy();
  if (rsiChart) rsiChart.destroy();

  priceChart = new Chart(document.getElementById('priceChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Close', data: closes, borderColor: '#38bdf8', pointRadius: 0, tension: 0.15 },
        { label: 'SMA20', data: s20, borderColor: '#22c55e', pointRadius: 0, tension: 0.15 },
        { label: 'SMA50', data: s50, borderColor: '#f59e0b', pointRadius: 0, tension: 0.15 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#dbe4f0' } } },
      scales: {
        x: { ticks: { color: '#9fb0c9', maxTicksLimit: 8 }, grid: { color: '#223147' } },
        y: { ticks: { color: '#9fb0c9' }, grid: { color: '#223147' } },
      },
    },
  });

  rsiChart = new Chart(document.getElementById('rsiChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'RSI14', data: rsi, borderColor: '#a78bfa', pointRadius: 0, tension: 0.12 },
        { label: 'Overbought 70', data: new Array(labels.length).fill(70), borderColor: '#ef4444', pointRadius: 0, borderDash: [6, 6] },
        { label: 'Oversold 30', data: new Array(labels.length).fill(30), borderColor: '#22c55e', pointRadius: 0, borderDash: [6, 6] },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#dbe4f0' } } },
      scales: {
        x: { ticks: { color: '#9fb0c9', maxTicksLimit: 8 }, grid: { color: '#223147' } },
        y: { min: 0, max: 100, ticks: { color: '#9fb0c9' }, grid: { color: '#223147' } },
      },
    },
  });
}

async function runCheck() {
  const ticker = tickerInput.value.trim().toUpperCase();
  statusEl.textContent = '';
  resultEl.classList.add('hidden');
  clearLog();

  if (!ticker) {
    statusEl.textContent = 'Please enter a ticker.';
    logStep('Ticker input missing.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Checking...';
  logStep(`Requested ticker: ${ticker}`);

  try {
    const rows = await fetchRowsWithFallback(ticker);
    logStep(`Computing indicators from ${rows.length} rows.`);
    const m = computeMetrics(rows);
    logStep(`Analysis complete. Score=${m.score}/${m.maxScore}, verdict=${m.verdict}.`);

    verdictEl.textContent = `${ticker}: ${m.verdict} (${m.score}/${m.maxScore})`;
    verdictEl.style.color = m.verdictColor;
    asofEl.textContent = `As of ${m.lastTimestamp}`;

    metricsEl.innerHTML = '';
    metricsEl.appendChild(metricCard('Price', `$${fmt(m.price, 2)}`));
    metricsEl.appendChild(metricCard('5D Change', `${fmt(m.change5dPct, 2)}%`));
    metricsEl.appendChild(metricCard('20D Change', `${fmt(m.change20dPct, 2)}%`));
    metricsEl.appendChild(metricCard('SMA 20', `$${fmt(m.sma20, 2)}`));
    metricsEl.appendChild(metricCard('SMA 50', `$${fmt(m.sma50, 2)}`));
    metricsEl.appendChild(metricCard('RSI 14', `${fmt(m.rsi14, 2)}`));
    metricsEl.appendChild(metricCard('Volatility (20D ann.)', `${fmt(m.vol20Annualized, 3)}`));
    metricsEl.appendChild(metricCard('Volume vs 20D avg', `${fmt(m.volumeVs20d, 2)}x`));
    renderIndicatorMarkers(m.checks);
    renderCharts(rows);

    reasonsEl.innerHTML = '';
    m.reasons.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      reasonsEl.appendChild(li);
    });

    resultEl.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = err?.message || 'Unable to check ticker right now.';
    logStep(`Final error: ${err?.message || 'Unable to check ticker right now.'}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check Ticker';
    logStep('Request finished.');
  }
}

btn.addEventListener('click', runCheck);
tickerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runCheck();
});
