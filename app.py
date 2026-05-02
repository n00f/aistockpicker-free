#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf
from flask import Flask, jsonify, render_template, request

APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT.parent
MARKET_CACHE_DIR = PROJECT_ROOT / "market_cache" / "daily"

app = Flask(__name__)


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return float(default)


def _load_symbol_bars(symbol: str) -> pd.DataFrame:
    ticker = str(symbol or "").upper().strip()
    if not ticker:
        raise ValueError("Ticker is required.")
    path = MARKET_CACHE_DIR / f"{ticker}.csv"
    if not path.exists():
        raise FileNotFoundError(f"No cached data found for {ticker}.")
    df = pd.read_csv(path)
    if df.empty or "close" not in df.columns:
        raise ValueError(f"Cached data for {ticker} is invalid.")
    return df


def _load_symbol_bars_yahoo(symbol: str) -> pd.DataFrame:
    ticker = str(symbol or "").upper().strip()
    if not ticker:
        raise ValueError("Ticker is required.")
    df = yf.download(
        tickers=ticker,
        period="1y",
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if df is None or df.empty:
        raise ValueError(f"No Yahoo data returned for {ticker}.")
    out = df.reset_index()
    out.columns = [str(c).lower() for c in out.columns]
    rename_map = {"date": "timestamp", "adj close": "adj_close"}
    out = out.rename(columns=rename_map)
    for col in ("open", "high", "low", "close", "volume"):
        if col not in out.columns:
            out[col] = pd.NA
    return out


def _compute_free_tier_metrics(df: pd.DataFrame) -> dict[str, Any]:
    data = df.copy()
    data["close"] = pd.to_numeric(data["close"], errors="coerce")
    data["volume"] = pd.to_numeric(data.get("volume"), errors="coerce")
    data = data.dropna(subset=["close"]).reset_index(drop=True)
    if len(data) < 30:
        raise ValueError("Not enough history in cache (need at least 30 rows).")

    close = data["close"]
    volume = data["volume"].fillna(0.0)

    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    ret_5 = close.pct_change(5)
    ret_20 = close.pct_change(20)
    daily_ret = close.pct_change()
    vol_20 = daily_ret.rolling(20).std() * (252.0 ** 0.5)

    delta = close.diff()
    up = delta.clip(lower=0.0)
    down = (-delta).clip(lower=0.0)
    roll_up = up.rolling(14).mean()
    roll_down = down.rolling(14).mean()
    rs = roll_up / roll_down.replace(0.0, pd.NA)
    rsi_14 = 100.0 - (100.0 / (1.0 + rs))

    vol_avg_20 = volume.rolling(20).mean()
    vol_ratio = volume / vol_avg_20.replace(0.0, pd.NA)

    last_idx = len(data) - 1
    price = _safe_float(close.iloc[last_idx])
    s20 = _safe_float(sma20.iloc[last_idx], price)
    s50 = _safe_float(sma50.iloc[last_idx], price)
    r5 = _safe_float(ret_5.iloc[last_idx])
    r20 = _safe_float(ret_20.iloc[last_idx])
    v20 = _safe_float(vol_20.iloc[last_idx])
    rsi = _safe_float(rsi_14.iloc[last_idx], 50.0)
    vr = _safe_float(vol_ratio.iloc[last_idx], 1.0)

    score = 0
    reasons: list[str] = []

    if price > s20:
        score += 1
        reasons.append("Price is above 20-day trend")
    if s20 > s50:
        score += 1
        reasons.append("Short trend is above medium trend")
    if r20 > 0:
        score += 1
        reasons.append("20-day momentum is positive")
    if 45 <= rsi <= 70:
        score += 1
        reasons.append("RSI is in a constructive range")
    if v20 < 0.45:
        score += 1
        reasons.append("Volatility is moderate")

    if score >= 4:
        verdict = "GOOD PICK"
        verdict_color = "#16a34a"
    elif score == 3:
        verdict = "WATCHLIST"
        verdict_color = "#d97706"
    else:
        verdict = "HIGH RISK"
        verdict_color = "#dc2626"

    latest_ts = str(data.iloc[last_idx].get("timestamp", "-"))

    return {
        "last_timestamp": latest_ts,
        "price": round(price, 4),
        "change_5d_pct": round(r5 * 100.0, 2),
        "change_20d_pct": round(r20 * 100.0, 2),
        "sma20": round(s20, 4),
        "sma50": round(s50, 4),
        "rsi14": round(rsi, 2),
        "volatility_20d_annualized": round(v20, 4),
        "volume_vs_20d": round(vr, 2),
        "score": score,
        "max_score": 5,
        "verdict": verdict,
        "verdict_color": verdict_color,
        "reasons": reasons,
    }


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/free-check")
def free_check():
    payload = request.get_json(silent=True) or {}
    symbol = str(payload.get("ticker", "")).upper().strip()
    if not symbol:
        return jsonify({"ok": False, "error": "Please enter a ticker."}), 400

    try:
        # Prefer fresh Yahoo bars in production; fallback to local cache for resilience.
        try:
            bars = _load_symbol_bars_yahoo(symbol)
        except Exception:
            bars = _load_symbol_bars(symbol)
        metrics = _compute_free_tier_metrics(bars)
        return jsonify({"ok": True, "ticker": symbol, "metrics": metrics})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
