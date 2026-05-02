# AI Stock Picker (Static GitHub Pages)

Pure static version of the free-tier stock checker.

## How it works
- Runs fully in the user's browser (client-side JavaScript)
- Fetches daily price data from a public CSV endpoint
- Computes metrics locally: SMA20/50, RSI14, 5D/20D returns, volatility, volume ratio
- Produces a quick verdict: `GOOD PICK`, `WATCHLIST`, or `HIGH RISK`

## Local preview
Open `index.html` directly, or run any static server.

## Publish on GitHub Pages
1. Push this repo to GitHub.
2. In GitHub repo settings: `Pages`.
3. Source: `Deploy from a branch`.
4. Branch: `main`, folder: `/ (root)`.
5. Save.

Your site will publish at:
- `https://<username>.github.io/<repo>/`

## Notes
- No backend required.
- Market-data endpoints can rate-limit under heavy traffic.
- For paid/pro features, use a backend for auth, billing, and protected picks.
