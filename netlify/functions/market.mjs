import { SP500_FALLBACK, SP500_FALLBACK_AS_OF } from "./_sp500Fallback.mjs";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

const PULSE_INSTRUMENTS = [
  { symbol: "SPY", label: "S&P 500", description: "SPY ETF proxy" },
  { symbol: "QQQ", label: "Nasdaq 100", description: "QQQ ETF proxy" },
  { symbol: "SOXX", label: "Semiconductors", description: "Chip-sector ETF" },
  { symbol: "MU", label: "Micron", description: "Memory-chip leader" },
  { symbol: "NVDA", label: "Nvidia", description: "AI-chip bellwether" },
  { symbol: "AAPL", label: "Apple", description: "Mega-cap technology" }
];

export default async (request) => {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "quotes";
  const universe = url.searchParams.get("universe") || "";
  const symbolLimit = view === "earnings" ? 150 : 25;
  const symbols = [...new Set((url.searchParams.get("symbols") || "")
    .split(",")
    .map(symbol => symbol.trim())
    .filter(Boolean))]
    .slice(0, symbolLimit);
  const days = Math.min(120, Math.max(7, Number(url.searchParams.get("days")) || 90));

  const apiKey = Netlify.env.get("FINNHUB_API_KEY");
  if (!apiKey) {
    return json({ error: "FINNHUB_API_KEY is not configured." }, 503);
  }

  try {
    if (view === "pulse") return await getPulse(apiKey);
    if (view === "fundamentals") {
      if (!symbols.length) return json({ error: "A stock symbol is required." }, 400);
      return await getFundamentals(symbols[0], apiKey);
    }
    if (view === "earnings") return await getEarnings(symbols, apiKey, days, universe);
    if (!symbols.length) return json({ error: "At least one symbol is required." }, 400);
    if (view === "quotes") return await getQuotes(symbols, apiKey);
    return json({ error: "Unknown view." }, 400);
  } catch (error) {
    console.error("Market function failed:", error);
    return json({ error: "Market data request failed." }, 502);
  }
};

async function getFundamentals(symbol, apiKey) {
  const encoded = encodeURIComponent(symbol);
  const headers = { "X-Finnhub-Token": apiKey };
  const [quoteResponse, metricResponse, profileResponse] = await Promise.all([
    fetch(`${FINNHUB_BASE}/quote?symbol=${encoded}`, { headers }),
    fetch(`${FINNHUB_BASE}/stock/metric?symbol=${encoded}&metric=all`, { headers }),
    fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${encoded}`, { headers })
  ]);

  if (!quoteResponse.ok) throw new Error(`Finnhub quote returned ${quoteResponse.status}`);
  const quote = await quoteResponse.json();
  if (!Number(quote.c)) return json({ error: `No market data was found for ${symbol}.` }, 404);

  const metricPayload = metricResponse.ok ? await metricResponse.json() : {};
  const profile = profileResponse.ok ? await profileResponse.json() : {};
  const metric = metricPayload.metric || {};

  const marketCapMillions = firstFinite(profile.marketCapitalization, metric.marketCapitalization);
  const averageVolumeMillions = firstFinite(
    metric["10DayAverageTradingVolume"],
    metric["3MonthAverageTradingVolume"]
  );

  return json({
    symbol,
    profile: {
      name: profile.name || symbol,
      exchange: profile.exchange || null,
      industry: profile.finnhubIndustry || null,
      currency: profile.currency || "USD",
      country: profile.country || null,
      logo: profile.logo || null
    },
    quote,
    metrics: {
      marketCap: marketCapMillions === null ? null : marketCapMillions * 1_000_000,
      averageVolume10d: averageVolumeMillions === null ? null : averageVolumeMillions * 1_000_000,
      peTtm: firstFinite(metric.peBasicExclExtraTTM, metric.peTTM, metric.peExclExtraTTM),
      dividendYield: firstFinite(metric.dividendYieldIndicatedAnnual, metric.dividendYieldTTM),
      priceToBook: firstFinite(metric.pbAnnual, metric.pbQuarterly, metric.priceToBook),
      beta: firstFinite(metric.beta),
      week52High: firstFinite(metric["52WeekHigh"]),
      week52Low: firstFinite(metric["52WeekLow"]),
      revenueGrowth: firstFinite(metric.revenueGrowthTTMYoy, metric.revenueGrowthQuarterlyYoy, metric.revenueGrowth3Y)
    },
    asOf: new Date().toISOString()
  }, 200, 900);
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function getPulse(apiKey) {
  const quotes = await fetchQuotes(PULSE_INSTRUMENTS.map(item => item.symbol), apiKey);
  const pulse = PULSE_INSTRUMENTS.map(item => ({
    ...item,
    quote: quotes[item.symbol] || null
  }));
  return json({ pulse }, 200, 180);
}

async function getQuotes(symbols, apiKey) {
  const quotes = await fetchQuotes(symbols, apiKey);
  const fx = await getFx(apiKey);
  return json({ quotes, fx }, 200, 300);
}

async function fetchQuotes(symbols, apiKey) {
  const entries = await Promise.all(symbols.map(async symbol => {
    const response = await fetch(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}`, {
      headers: { "X-Finnhub-Token": apiKey }
    });
    if (!response.ok) return [symbol, null];
    const quote = await response.json();
    return [symbol, Number(quote.c) > 0 ? quote : null];
  }));

  return Object.fromEntries(entries.filter(([, quote]) => quote));
}

async function getEarnings(extraSymbols, apiKey, days, universeId) {
  const today = new Date();
  const to = new Date(today);
  to.setDate(to.getDate() + days);

  const universe = universeId === "sp500"
    ? await getSp500Universe()
    : { companies: [], label: "Custom watchlist", tickerCount: 0, companyCount: 0, asOf: null, source: null, fallback: false };

  const companyMap = new Map();
  universe.companies.forEach(company => companyMap.set(canonicalSymbol(company.symbol), company));
  extraSymbols.forEach(symbol => {
    const key = canonicalSymbol(symbol);
    if (!companyMap.has(key)) {
      companyMap.set(key, {
        symbol,
        name: symbol,
        sector: "Custom watchlist",
        category: "custom",
        weight: null
      });
    }
  });

  const endpoint = `${FINNHUB_BASE}/calendar/earnings?from=${isoDate(today)}&to=${isoDate(to)}`;
  const response = await fetch(endpoint, { headers: { "X-Finnhub-Token": apiKey } });
  if (!response.ok) throw new Error(`Finnhub earnings returned ${response.status}`);

  const data = await response.json();
  const earnings = (data.earningsCalendar || [])
    .map(event => {
      const company = companyMap.get(canonicalSymbol(event.symbol));
      if (!company) return null;
      return {
        ...event,
        companyName: company.name,
        sector: company.sector,
        category: company.category,
        indexWeight: company.weight,
        universe: universeId === "sp500" && universe.companies.some(item => canonicalSymbol(item.symbol) === canonicalSymbol(event.symbol))
          ? "sp500"
          : "custom"
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.symbol).localeCompare(String(b.symbol)));

  return json({
    earnings,
    windowDays: days,
    watchedSymbols: companyMap.size,
    matchedSymbols: new Set(earnings.map(item => canonicalSymbol(item.symbol))).size,
    universe: {
      id: universeId || "custom",
      label: universe.label,
      companyCount: universe.companyCount,
      tickerCount: universe.tickerCount,
      asOf: universe.asOf,
      source: universe.source,
      fallback: universe.fallback
    }
  }, 200, 1800);
}

async function getSp500Universe() {
  const url = "https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv";
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Personal Investor Intelligence Dashboard",
        "Accept": "text/csv,text/plain;q=0.9,*/*;q=0.8"
      }
    });
    if (!response.ok) throw new Error(`iShares holdings returned ${response.status}`);
    const text = await response.text();
    const parsed = parseIsharesHoldings(text);
    if (parsed.companies.length < 490) throw new Error("The iShares holdings file did not contain a complete equity universe.");
    return {
      companies: parsed.companies,
      label: "S&P 500",
      companyCount: 500,
      tickerCount: parsed.companies.length,
      asOf: parsed.asOf,
      source: "iShares IVV holdings",
      fallback: false
    };
  } catch (error) {
    console.warn("Using bundled S&P 500 fallback:", error.message);
    return {
      companies: SP500_FALLBACK,
      label: "S&P 500",
      companyCount: 500,
      tickerCount: SP500_FALLBACK.length,
      asOf: SP500_FALLBACK_AS_OF,
      source: "Bundled IVV holdings snapshot",
      fallback: true
    };
  }
}

function parseIsharesHoldings(text) {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex(row => row[0] === "Ticker");
  if (headerIndex < 0) return { companies: [], asOf: null };

  const asOfRow = rows.find(row => row[0] === "Fund Holdings as of");
  const asOf = asOfRow?.[1] || null;
  const headers = rows[headerIndex];
  const companies = [];

  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length < headers.length) continue;
    const item = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
    const price = Number(String(item.Price || "0").replaceAll(",", ""));
    if (item["Asset Class"] !== "Equity" || !item.Ticker || item.Ticker === "-" || /NO MARKET/i.test(item.Exchange || "") || price <= 0.1) continue;
    companies.push({
      symbol: item.Ticker,
      name: titleCaseCompany(item.Name || item.Ticker),
      sector: item.Sector || "Other",
      category: sectorCategory(item.Sector),
      weight: numberOrNull(item["Weight (%)"])
    });
  }

  return { companies, asOf };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = "";
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function canonicalSymbol(symbol) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sectorCategory(sector) {
  const categories = {
    "Information Technology": "technology",
    "Communication": "communication",
    "Consumer Discretionary": "consumer-discretionary",
    "Consumer Staples": "consumer-staples",
    "Financials": "financials",
    "Health Care": "health-care",
    "Industrials": "industrials",
    "Energy": "energy",
    "Utilities": "utilities",
    "Real Estate": "real-estate",
    "Materials": "materials"
  };
  return categories[String(sector || "")] || "other";
}

function numberOrNull(value) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function titleCaseCompany(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase())
    .replace(/\bInc\b/g, "Inc")
    .replace(/\bCorp\b/g, "Corp")
    .replace(/\bPlc\b/g, "PLC")
    .replace(/\bReit\b/g, "REIT");
}

async function getFx(apiKey) {
  const response = await fetch(`${FINNHUB_BASE}/forex/rates?base=GBP`, {
    headers: { "X-Finnhub-Token": apiKey }
  });
  if (!response.ok) return { GBP: 1, USD: 0.79 };

  const data = await response.json();
  const usdPerGbp = Number(data.quote?.USD);
  return {
    GBP: 1,
    USD: usdPerGbp ? 1 / usdPerGbp : 0.79,
    EUR: Number(data.quote?.EUR) ? 1 / Number(data.quote.EUR) : 0.86
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` : "no-store"
    }
  });
}
