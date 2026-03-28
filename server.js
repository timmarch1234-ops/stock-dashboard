const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const ATH = {
  META:  { price: 788.15, date: 'Aug 12, 2025',  name: 'Meta',   color: '#0082FB' },
  GOOGL: { price: 343.45, date: 'Feb 2, 2026',   name: 'Google', color: '#34A853' },
  TSLA:  { price: 489.88, date: 'Dec 16, 2025',  name: 'Tesla',  color: '#E31937' },
  AMZN:  { price: 254.00, date: 'Nov 3, 2025',   name: 'Amazon', color: '#FF9900' },
};

async function fetchQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);
  const data = await res.json();
  const meta = data.chart.result[0].meta;
  return {
    price: meta.regularMarketPrice,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    prev: meta.chartPreviousClose,
    state: meta.marketState,
  };
}

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
        volume: q.volume,
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
