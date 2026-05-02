# Clawbot Free Tier Web App

Standalone public-facing web app for free-tier stock checks.

## What it does
- User enters a ticker (example: `AAPL`)
- App reads local cached bars from `../market_cache/daily/<TICKER>.csv`
- App returns current metrics + simple verdict (`GOOD PICK`, `WATCHLIST`, `HIGH RISK`)

## Run

```bash
cd clawbot_web_free
pip install -r requirements.txt
python app.py
```

Open:
- `http://127.0.0.1:8080`

## Notes
- This free tier uses local cache data only.
- If a ticker file is missing from `market_cache/daily`, the app returns a friendly error.
- Your existing `clawbot_dash.py` is untouched.
