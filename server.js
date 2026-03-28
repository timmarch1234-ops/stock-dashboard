const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
// Serve index.html directly to bypass any CDN caching
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

const ATH = {
  META:  { price: 796.25, date: 'Aug 15, 2025',  name: 'Meta',      color: '#0082FB' },
  GOOGL: { price: 349.00, date: 'Feb 3, 2026',   name: 'Alphabet',  color: '#34A853' },
  TSLA:  { price: 498.83, date: 'Dec 22, 2025',  name: 'Tesla',     color: '#E31937' },
  AMZN:  { price: 258.60, date: 'Nov 3, 2025',   name: 'Amazon',    color: '#FF9900' },
  MSFT:  { price: 555.45, date: 'Jul 31, 2025',  name: 'Microsoft', color: '#00A4EF' },
  NVDA:  { price: 212.19, date: 'Oct 29, 2025',  name: 'NVIDIA',    color: '#76B900' },
};

async function fetchQuote(ticker) {
  // Fetch 5d range to get weekly change
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);
  const data = await res.json();
  const result = data.chart.result[0];
  const meta = result.meta;
  const closes = result.indicators.quote[0].close.filter(Boolean);
  const weekStartPrice = closes.length >= 2 ? closes[0] : null;
  const weekChangePct = weekStartPrice
    ? ((meta.regularMarketPrice - weekStartPrice) / weekStartPrice) * 100
    : null;
  return {
    price: meta.regularMarketPrice,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    prev: meta.chartPreviousClose,
    state: meta.marketState,
    weekChangePct: weekChangePct !== null ? +weekChangePct.toFixed(2) : null,
  };
}

// History cache: { ticker: { data, fetchedAt } }
const historyCache = {};

async function fetchHistory(ticker, range = '1y') {
  const cached = historyCache[ticker];
  if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return cached.data; // 1hr cache

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker} history`);
  const json = await res.json();
  const result = json.chart.result[0];
  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;

  const data = timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    close: closes[i] ? +closes[i].toFixed(2) : null,
  })).filter(d => d.close !== null);

  historyCache[ticker] = { data, fetchedAt: Date.now() };
  return data;
}

app.get('/api/history/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  if (!ATH[ticker]) return res.status(404).json({ error: 'Unknown ticker' });
  try {
    const data = await fetchHistory(ticker);
    res.json({ ticker, ath: ATH[ticker].price, history: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const tickers = Object.keys(ATH);
    const results = await Promise.all(tickers.map(async (ticker) => {
      const q = await fetchQuote(ticker);
      const current = q.price;
      const ath = ATH[ticker].price;
      const pctFromATH = ((current - ath) / ath) * 100;
      const change = current - q.prev;
      const changePct = (change / q.prev) * 100;
      return {
        ticker,
        name: ATH[ticker].name,
        color: ATH[ticker].color,
        current,
        ath,
        athDate: ATH[ticker].date,
        pctFromATH: +pctFromATH.toFixed(2),
        change: +change.toFixed(2),
        changePct: +changePct.toFixed(2),
        high: q.high,
        low: q.low,
        weekChangePct: q.weekChangePct,
        marketState: q.state,
      };
    }));
    res.json({ stocks: results, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3737;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
