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

// Stock metadata (no hardcoded ATH prices — pulled live from Yahoo Finance)
const STOCKS = {
  META:  { name: 'Meta',      color: '#0082FB', ipoDate: '2012-05-18' },
  GOOGL: { name: 'Alphabet',  color: '#34A853', ipoDate: '2004-08-19' },
  NVDA:  { name: 'NVIDIA',    color: '#76B900', ipoDate: '1999-01-22' },
  MSFT:  { name: 'Microsoft', color: '#00A4EF', ipoDate: '1986-03-13' },
  AAPL:  { name: 'Apple',     color: '#A2AAAD', ipoDate: '1980-12-12' },
  AMZN:  { name: 'Amazon',    color: '#FF9900', ipoDate: '1997-05-15' },
  TSLA:  { name: 'Tesla',     color: '#E31937', ipoDate: '2010-06-29' },
};

// ATH cache: recalculated once per day
const athCache = {};

async function fetchATH(ticker) {
  const cached = athCache[ticker];
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return cached;

  const ipoDate = STOCKS[ticker].ipoDate;
  const period1 = Math.floor(new Date(ipoDate).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${period1}&period2=${period2}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ATH for ${ticker}`);
  const json = await res.json();
  const result = json.chart.result[0];
  const highs = result.indicators.quote[0].high;
  const timestamps = result.timestamp;

  let athPrice = 0, athDate = '';
  highs.forEach((h, i) => {
    if (h && h > athPrice) {
      athPrice = h;
      athDate = new Date(timestamps[i] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  });

  const data = { price: +athPrice.toFixed(2), date: athDate, fetchedAt: Date.now() };
  athCache[ticker] = data;
  return data;
}

async function fetchQuote(ticker) {
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

// History cache: refreshed hourly
const historyCache = {};

async function fetchHistory(ticker) {
  const cached = historyCache[ticker];
  if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
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
  if (!STOCKS[ticker]) return res.status(404).json({ error: 'Unknown ticker' });
  try {
    const [data, ath] = await Promise.all([fetchHistory(ticker), fetchATH(ticker)]);
    res.json({ ticker, ath: ath.price, history: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const tickers = Object.keys(STOCKS);
    const results = await Promise.all(tickers.map(async (ticker) => {
      const [q, ath] = await Promise.all([fetchQuote(ticker), fetchATH(ticker)]);
      const current = q.price;
      const pctFromATH = ((current - ath.price) / ath.price) * 100;
      const change = current - q.prev;
      const changePct = (change / q.prev) * 100;
      return {
        ticker,
        name: STOCKS[ticker].name,
        color: STOCKS[ticker].color,
        current,
        ath: ath.price,
        athDate: ath.date,
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
