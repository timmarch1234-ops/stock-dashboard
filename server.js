import YahooFinance from 'yahoo-finance2';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

const app = express();
const PORT = process.env.PORT || 3000;

// Stock config with IPO dates for ATH calculation
const STOCKS = [
  { ticker: 'META', name: 'Meta Platforms', ipoDate: '2012-05-18' },
  { ticker: 'GOOGL', name: 'Alphabet (Google)', ipoDate: '2004-08-19' },
  { ticker: 'TSLA', name: 'Tesla', ipoDate: '2010-06-29' },
  { ticker: 'AMZN', name: 'Amazon', ipoDate: '1997-05-15' },
];

// Cache
let priceCache = null;
let priceCacheTime = 0;
const PRICE_TTL = 60 * 1000; // 60 seconds

let athCache = {}; // { ticker: { ath, athDate } }
let athCacheDate = null; // YYYY-MM-DD string

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getATH(ticker, ipoDate) {
  const today = todayStr();
  if (athCacheDate === today && athCache[ticker]) {
    return athCache[ticker];
  }

  console.log(`Fetching historical data for ${ticker} from ${ipoDate}...`);
  try {
    const result = await yahooFinance.chart(ticker, {
      period1: ipoDate,
      period2: today,
      interval: '1mo',
    });

    let ath = 0;
    const quotes = result?.quotes || [];
    for (const row of quotes) {
      if (row.high && row.high > ath) {
        ath = row.high;
      }
    }

    athCache[ticker] = { ath };
    athCacheDate = today;
    return athCache[ticker];
  } catch (err) {
    console.error(`Error fetching historical for ${ticker}:`, err.message);
    return athCache[ticker] || { ath: 0 };
  }
}

async function fetchStockData() {
  const now = Date.now();
  if (priceCache && now - priceCacheTime < PRICE_TTL) {
    return priceCache;
  }

  const results = await Promise.all(
    STOCKS.map(async ({ ticker, name, ipoDate }) => {
      try {
        const [quote, athData] = await Promise.all([
          yahooFinance.quote(ticker),
          getATH(ticker, ipoDate),
        ]);

        const currentPrice = quote.regularMarketPrice || 0;
        const ath = athData.ath || 0;
        let percentFromAth = 0;
        if (ath > 0 && currentPrice < ath) {
          percentFromAth = ((ath - currentPrice) / ath) * 100;
        }

        return {
          ticker,
          name,
          currentPrice: parseFloat(currentPrice.toFixed(2)),
          ath: parseFloat(ath.toFixed(2)),
          percentFromAth: parseFloat(percentFromAth.toFixed(2)),
          lastUpdated: new Date().toISOString(),
        };
      } catch (err) {
        console.error(`Error fetching ${ticker}:`, err.message);
        return {
          ticker,
          name,
          currentPrice: null,
          ath: null,
          percentFromAth: null,
          lastUpdated: new Date().toISOString(),
          error: err.message,
        };
      }
    })
  );

  priceCache = results;
  priceCacheTime = now;
  return results;
}

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// API endpoint
app.get('/api/stocks', async (req, res) => {
  try {
    const data = await fetchStockData();
    res.json(data);
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Stock dashboard running on http://localhost:${PORT}`);
  // Pre-warm cache
  fetchStockData().catch(console.error);
});
