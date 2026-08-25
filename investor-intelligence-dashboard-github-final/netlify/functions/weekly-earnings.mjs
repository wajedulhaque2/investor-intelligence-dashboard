import { FTSE100, FTSE100_AS_OF } from "./_ftse100.mjs";

const YAHOO_CALENDAR_URL = "https://query1.finance.yahoo.com/v1/finance/visualization";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const PAGE_SIZE = 100;
const MAX_PAGES = 15;

const INCLUDE_FIELDS = [
  "ticker",
  "companyshortname",
  "intradaymarketcap",
  "eventname",
  "startdatetime",
  "startdatetimetype",
  "epsestimate",
  "epsactual",
  "epssurprisepct"
];

const FTSE_SYMBOL_SET = new Set(FTSE100.map(item => normaliseLondonSymbol(item.symbol)));

const REGION_CONFIG = {
  US: {
    market: "US",
    queryRegion: "us",
    requestRegion: "US",
    lang: "en-US",
    origin: "https://finance.yahoo.com",
    referer: "https://finance.yahoo.com/calendar/earnings/"
  },
  UK: {
    market: "UK",
    queryRegion: "gb",
    requestRegion: "GB",
    lang: "en-GB",
    origin: "https://uk.finance.yahoo.com",
    referer: "https://uk.finance.yahoo.com/calendar/earnings/"
  }
};

export default async (request) => {
  const url = new URL(request.url);
  const weekOffset = Math.min(4, Math.max(-4, Number(url.searchParams.get("weekOffset")) || 0));
  const { start, end } = currentYahooWeek(weekOffset);

  try {
    const yahoo = await fetchYahooWeek(start, end);
    if (yahoo.earnings.length) {
      return json({
        earnings: yahoo.earnings,
        count: yahoo.earnings.length,
        marketCounts: countMarkets(yahoo.earnings),
        weekStart: start,
        weekEnd: end,
        source: "Yahoo Finance US + UK calendars",
        sourceUrl: `https://finance.yahoo.com/calendar/earnings/?day=${start}`,
        pagesLoaded: yahoo.pagesLoaded,
        truncated: yahoo.truncated,
        regionStatus: yahoo.regionStatus,
        ftse100AsOf: FTSE100_AS_OF,
        fallback: false,
        generatedAt: new Date().toISOString()
      }, 200, 1800);
    }
    throw new Error("Yahoo returned no weekly US or FTSE 100 earnings rows.");
  } catch (error) {
    console.warn("Yahoo weekly earnings unavailable, using Finnhub fallback:", error.message);
    const apiKey = Netlify.env.get("FINNHUB_API_KEY");
    if (!apiKey) {
      return json({
        error: "Yahoo Finance was unavailable and FINNHUB_API_KEY is not configured for fallback."
      }, 502);
    }

    try {
      const earnings = await fetchFinnhubWeek(start, end, apiKey);
      return json({
        earnings,
        count: earnings.length,
        marketCounts: countMarkets(earnings),
        weekStart: start,
        weekEnd: end,
        source: "Finnhub fallback",
        sourceUrl: "https://finnhub.io/",
        pagesLoaded: { US: 1, UK: 1 },
        truncated: false,
        ftse100AsOf: FTSE100_AS_OF,
        fallback: true,
        generatedAt: new Date().toISOString()
      }, 200, 900);
    } catch (fallbackError) {
      console.error("Weekly earnings fallback failed:", fallbackError);
      return json({ error: "Both Yahoo Finance and the Finnhub fallback failed." }, 502);
    }
  }
};

async function fetchYahooWeek(start, end) {
  const auth = await getYahooAuth();
  const settled = await Promise.allSettled([
    fetchYahooRegion(start, end, auth, REGION_CONFIG.US),
    fetchYahooRegion(start, end, auth, REGION_CONFIG.UK)
  ]);

  const regionStatus = {};
  const earnings = [];
  let truncated = false;
  const pagesLoaded = { US: 0, UK: 0 };

  settled.forEach((result, index) => {
    const market = index === 0 ? "US" : "UK";
    if (result.status === "fulfilled") {
      regionStatus[market] = "ok";
      earnings.push(...result.value.earnings);
      pagesLoaded[market] = result.value.pagesLoaded;
      truncated = truncated || result.value.truncated;
    } else {
      regionStatus[market] = result.reason?.message || "unavailable";
      console.warn(`${market} Yahoo earnings region failed:`, result.reason?.message);
    }
  });

  const seen = new Set();
  const deduped = earnings
    .filter(event => {
      const key = `${event.market}|${event.symbol}|${event.date}|${event.eventName || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      marketOrder(a.market) - marketOrder(b.market) ||
      Number(b.marketCap || 0) - Number(a.marketCap || 0)
    );

  return { earnings: deduped, pagesLoaded, truncated, regionStatus };
}

async function fetchYahooRegion(start, end, auth, config) {
  const earnings = [];
  let pagesLoaded = 0;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const body = {
      sortType: "DESC",
      entityIdType: "sp_earnings",
      sortField: "intradaymarketcap",
      includeFields: INCLUDE_FIELDS,
      size: PAGE_SIZE,
      offset,
      query: {
        operator: "AND",
        operands: [
          { operator: "EQ", operands: ["region", config.queryRegion] },
          {
            operator: "OR",
            operands: [
              { operator: "EQ", operands: ["eventtype", "EAD"] },
              { operator: "EQ", operands: ["eventtype", "ERA"] }
            ]
          },
          { operator: "GTE", operands: ["startdatetime", start] },
          { operator: "LTE", operands: ["startdatetime", end] }
        ]
      }
    };

    const params = new URLSearchParams({
      lang: config.lang,
      region: config.requestRegion
    });
    if (auth.crumb) params.set("crumb", auth.crumb);

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json,text/plain,*/*",
      "User-Agent": yahooUserAgent(),
      "Origin": config.origin,
      "Referer": config.referer
    };
    if (auth.cookie) headers.Cookie = auth.cookie;

    const response = await fetch(`${YAHOO_CALENDAR_URL}?${params.toString()}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`Yahoo ${config.market} calendar returned ${response.status}`);
    const payload = await response.json();
    const financeError = payload?.finance?.error;
    if (financeError) {
      throw new Error(financeError.description || financeError.code || `Yahoo ${config.market} calendar error`);
    }

    const document = payload?.finance?.result?.[0]?.documents?.[0];
    const rows = Array.isArray(document?.rows) ? document.rows : [];
    pagesLoaded += 1;

    for (const row of rows) {
      const event = normaliseYahooRow(row, config.market);
      if (!event || event.date < start || event.date > end) continue;
      if (config.market === "UK" && !FTSE_SYMBOL_SET.has(normaliseLondonSymbol(event.symbol))) continue;
      earnings.push(event);
    }

    if (rows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { earnings, pagesLoaded, truncated };
}

function normaliseYahooRow(row, market) {
  if (!Array.isArray(row)) return null;
  let symbol = String(row[0] || "").trim().toUpperCase();
  if (market === "UK") symbol = normaliseLondonSymbol(symbol);

  const startDateTime = row[4];
  const date = normaliseDate(startDateTime);
  if (!symbol || !date) return null;

  return {
    symbol,
    companyName: cleanText(row[1]) || symbol,
    market,
    exchange: market === "UK" ? "LSE" : "US",
    index: market === "UK" ? "FTSE 100" : "US market",
    marketCap: finiteOrNull(row[2]),
    eventName: cleanText(row[3]),
    date,
    startDateTime: startDateTime || null,
    hour: normaliseTiming(row[5]),
    timingRaw: cleanText(row[5]),
    epsEstimate: finiteOrNull(row[6]),
    epsActual: finiteOrNull(row[7]),
    epsSurprisePct: finiteOrNull(row[8]),
    source: "Yahoo Finance",
    sourceUrl: market === "UK"
      ? `https://uk.finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`
      : `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`
  };
}

async function getYahooAuth() {
  const userAgent = yahooUserAgent();
  let cookie = "";
  let crumb = "";

  try {
    const cookieResponse = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": userAgent, "Accept": "*/*" },
      redirect: "manual"
    });
    cookie = collectCookies(cookieResponse.headers);

    const crumbHeaders = { "User-Agent": userAgent, "Accept": "text/plain,*/*" };
    if (cookie) crumbHeaders.Cookie = cookie;
    const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: crumbHeaders
    });
    const crumbText = (await crumbResponse.text()).trim();
    if (crumbResponse.ok && crumbText && !/<html|too many requests/i.test(crumbText)) crumb = crumbText;
    const extraCookies = collectCookies(crumbResponse.headers);
    if (extraCookies) cookie = mergeCookieStrings(cookie, extraCookies);
  } catch (error) {
    console.warn("Yahoo cookie/crumb setup failed; attempting anonymous calendar request:", error.message);
  }

  return { cookie, crumb };
}

function collectCookies(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return values
    .flatMap(value => splitSetCookie(value))
    .map(value => value.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function splitSetCookie(value) {
  return String(value || "").split(/,(?=[^;,]+=)/g);
}

function mergeCookieStrings(first, second) {
  const map = new Map();
  `${first}; ${second}`.split(";").map(item => item.trim()).filter(Boolean).forEach(item => {
    const index = item.indexOf("=");
    if (index > 0) map.set(item.slice(0, index), item);
  });
  return [...map.values()].join("; ");
}

function yahooUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
}

async function fetchFinnhubWeek(start, end, apiKey) {
  const endpoint = `${FINNHUB_BASE}/calendar/earnings?from=${start}&to=${end}`;
  const response = await fetch(endpoint, { headers: { "X-Finnhub-Token": apiKey } });
  if (!response.ok) throw new Error(`Finnhub earnings returned ${response.status}`);
  const payload = await response.json();

  return (payload.earningsCalendar || [])
    .map(event => {
      const rawSymbol = String(event.symbol || "").toUpperCase();
      const londonSymbol = normaliseLondonSymbol(rawSymbol);
      const isUk = FTSE_SYMBOL_SET.has(londonSymbol);
      const isUs = isLikelyUsSymbol(rawSymbol);
      if (!isUk && !isUs) return null;
      const market = isUk ? "UK" : "US";
      const symbol = isUk ? londonSymbol : rawSymbol;

      return {
        symbol,
        companyName: event.symbol || "Unknown company",
        market,
        exchange: market === "UK" ? "LSE" : "US",
        index: market === "UK" ? "FTSE 100" : "US market",
        marketCap: null,
        eventName: "Earnings",
        date: event.date,
        startDateTime: null,
        hour: normaliseTiming(event.hour),
        timingRaw: event.hour || null,
        epsEstimate: finiteOrNull(event.epsEstimate),
        epsActual: finiteOrNull(event.epsActual),
        epsSurprisePct: finiteOrNull(event.surprisePercent),
        revenueEstimate: finiteOrNull(event.revenueEstimate),
        revenueActual: finiteOrNull(event.revenueActual),
        source: "Finnhub",
        sourceUrl: market === "UK"
          ? `https://uk.finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`
          : `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`
      };
    })
    .filter(event => event?.symbol && event?.date)
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      marketOrder(a.market) - marketOrder(b.market) ||
      String(a.symbol).localeCompare(String(b.symbol))
    );
}

function normaliseLondonSymbol(value) {
  let symbol = String(value || "").trim().toUpperCase();
  symbol = symbol.replace(/^LSE:|^LON:/, "");
  symbol = symbol.replace("BT/A.L", "BT-A.L");
  symbol = symbol.replace(/\/(?=\.L$)/, "");
  return symbol;
}

function isLikelyUsSymbol(symbol) {
  const value = String(symbol || "").toUpperCase();
  if (!value || value.endsWith(".L")) return false;
  if (/^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(value)) return true;
  return false;
}

function countMarkets(earnings) {
  return earnings.reduce((counts, event) => {
    const market = event.market === "UK" ? "UK" : "US";
    counts[market] = (counts[market] || 0) + 1;
    return counts;
  }, { US: 0, UK: 0 });
}

function marketOrder(market) {
  return market === "UK" ? 1 : 0;
}

function currentYahooWeek(offset = 0) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value])
  );
  const today = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  today.setUTCDate(today.getUTCDate() + offset * 7);
  const startDate = new Date(today);
  startDate.setUTCDate(today.getUTCDate() - today.getUTCDay());
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 6);
  return { start: isoDate(startDate), end: isoDate(endDate) };
}

function normaliseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : isoDate(date);
}

function normaliseTiming(value) {
  const timing = String(value || "").toUpperCase();
  if (timing.includes("BMO") || timing.includes("BEFORE")) return "bmo";
  if (timing.includes("AMC") || timing.includes("AFTER")) return "amc";
  if (timing.includes("DMH") || timing.includes("DURING")) return "dmh";
  return "tbc";
}

function cleanText(value) {
  return String(value ?? "").replace(/<[^>]+>/g, "").trim();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge
        ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`
        : "no-store"
    }
  });
}
