const btn = document.getElementById('checkBtn');
const tickerInput = document.getElementById('ticker');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const verdictEl = document.getElementById('verdict');
const asofEl = document.getElementById('asof');
const metricsEl = document.getElementById('metrics');
const reasonsEl = document.getElementById('reasons');

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

async function fetchCsvWithFallback(url) {
  try {
    const direct = await fetch(url);
    if (direct.ok) return await direct.text();
  } catch (_) {}

  const proxied = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
  if (!proxied.ok) {
    throw new Error('Could not fetch market data right now. Try again in a moment.');
  }
  return await proxied.text();
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

  let score = 0;
  const reasons = [];

  if (price > s20) { score += 1; reasons.push('Price is above 20-day trend'); }
  if (s20 > s50) { score += 1; reasons.push('Short trend is above medium trend'); }
  if (r20 > 0) { score += 1; reasons.push('20-day momentum is positive'); }
  if (rsi >= 45 && rsi <= 70) { score += 1; reasons.push('RSI is in a constructive range'); }
  if (vol20 < 0.45) { score += 1; reasons.push('Volatility is moderate'); }

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

async function runCheck() {
  const ticker = tickerInput.value.trim().toUpperCase();
  statusEl.textContent = '';
  resultEl.classList.add('hidden');

  if (!ticker) {
    statusEl.textContent = 'Please enter a ticker.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    const symbol = `${ticker.toLowerCase()}.us`;
    const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
    const csvText = await fetchCsvWithFallback(url);
    const rows = parseCsv(csvText);
    const m = computeMetrics(rows);

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

    reasonsEl.innerHTML = '';
    m.reasons.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      reasonsEl.appendChild(li);
    });

    resultEl.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = err?.message || 'Unable to check ticker right now.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check Ticker';
  }
}

btn.addEventListener('click', runCheck);
tickerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runCheck();
});
