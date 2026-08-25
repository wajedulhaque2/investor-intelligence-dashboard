import { SP500_FALLBACK } from "./_sp500Fallback.mjs";
import { FTSE100, FTSE100_AS_OF } from "./_ftse100.mjs";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const GOOGLE_NEWS_BASE = "https://news.google.com/rss/search";

const THEMES = [
  {
    category: "global",
    query: "(stock market OR S&P 500 OR Nasdaq OR FTSE 100 OR global markets) when:2d"
  },
  {
    category: "ftse100",
    query: "(FTSE 100 OR UK shares OR London stocks OR UK blue-chip stocks OR London Stock Exchange) when:3d"
  },
  {
    category: "memory",
    query: "(memory chips OR DRAM OR NAND OR HBM OR Micron OR SK Hynix OR Samsung semiconductor) when:4d"
  },
  {
    category: "megacaps",
    query: "(Nvidia OR Apple OR Microsoft OR Alphabet OR Amazon OR Meta OR Tesla) stock when:2d"
  },
  {
    category: "macro",
    query: "(Federal Reserve OR Bank of England OR interest rates OR tariffs OR oil prices OR China economy OR geopolitics) markets when:2d"
  }
];

const SYMBOL_FIXES = {
  BRKB: "BRK.B",
  BFA: "BF.A",
  BFB: "BF.B"
};

const CURATED_ALIASES = {
  "GOOGL": ["google", "alphabet"],
  "GOOG": ["google", "alphabet"],
  "META": ["meta platforms", "facebook", "instagram"],
  "AMZN": ["amazon", "aws"],
  "MSFT": ["microsoft"],
  "AAPL": ["apple", "iphone"],
  "NVDA": ["nvidia"],
  "AMD": ["advanced micro devices", "amd"],
  "MU": ["micron", "micron technology"],
  "TSLA": ["tesla"],
  "BRK.B": ["berkshire hathaway"],
  "JPM": ["jpmorgan", "jp morgan"],
  "BAC": ["bank of america"],
  "BA": ["boeing"],
  "DIS": ["walt disney", "disney"],
  "LLY": ["eli lilly", "lilly"],
  "XOM": ["exxon", "exxonmobil"],
  "CVX": ["chevron"],

  "III.L": ["3i", "3i group"],
  "AV.L": ["aviva"],
  "BA.L": ["bae systems", "bae"],
  "BP.L": ["bp plc"],
  "BT-A.L": ["bt group", "british telecom"],
  "JD.L": ["jd sports", "jd sports fashion"],
  "NG.L": ["national grid"],
  "RR.L": ["rolls-royce", "rolls royce"],
  "SN.L": ["smith & nephew", "smith and nephew"],
  "UU.L": ["united utilities"],
  "AZN.L": ["astrazeneca"],
  "BARC.L": ["barclays"],
  "BATS.L": ["british american tobacco"],
  "GSK.L": ["gsk", "glaxosmithkline"],
  "HSBA.L": ["hsbc"],
  "LLOY.L": ["lloyds", "lloyds banking group"],
  "NWG.L": ["natwest", "natwest group"],
  "LSEG.L": ["london stock exchange group", "lseg"],
  "MKS.L": ["marks & spencer", "marks and spencer", "m&s"],
  "MNG.L": ["m&g", "m and g"],
  "SHEL.L": ["shell", "shell plc"],
  "RIO.L": ["rio tinto"],
  "GLEN.L": ["glencore"],
  "AAL.L": ["anglo american"],
  "ANTO.L": ["antofagasta"],
  "FRES.L": ["fresnillo"],
  "TSCO.L": ["tesco"],
  "SBRY.L": ["sainsbury", "sainsbury's"],
  "ULVR.L": ["unilever"],
  "VOD.L": ["vodafone"],
  "IAG.L": ["international consolidated airlines", "british airways owner", "iag"],
  "EZJ.L": ["easyjet"],
  "REL.L": ["relx"],
  "SGE.L": ["sage group"],
  "SSE.L": ["sse plc"],
  "WPP.L": ["wpp"],
  "IMB.L": ["imperial brands"],
  "DGE.L": ["diageo"],
  "RKT.L": ["reckitt", "reckitt benckiser"],
  "HLN.L": ["haleon"],
  "LGEN.L": ["legal & general", "legal and general"],
  "STAN.L": ["standard chartered"],
  "PRU.L": ["prudential"],
  "PHNX.L": ["phoenix group"],
  "STJ.L": ["st james's place", "st james place"],
  "BTRW.L": ["barratt redrow"],
  "BKG.L": ["berkeley group"],
  "PSN.L": ["persimmon"],
  "SGRO.L": ["segro"],
  "LAND.L": ["landsec", "land securities"],
  "SMT.L": ["scottish mortgage investment trust"],
  "ALW.L": ["alliance witan"],
  "FCIT.L": ["f&c investment trust", "f and c investment trust"],
  "PCT.L": ["polar capital technology trust"]
};

const GENERIC_SINGLE_WORDS = new Set([
  "all", "auto", "block", "booking", "carrier", "compass", "crown", "diploma",
  "everest", "first", "international", "match", "news", "next", "old", "public",
  "rightmove", "sage", "target", "united", "western"
]);

const COMPANY_UNIVERSE = buildCompanyUniverse();
const COMPANY_BY_SYMBOL = new Map(COMPANY_UNIVERSE.map(company => [company.symbol, company]));

export default async (request) => {
  const url = new URL(request.url);
  const requestedSymbols = [...new Set((url.searchParams.get("symbols") || "")
    .split(",")
    .map(symbol => normaliseKnownSymbol(symbol))
    .filter(Boolean))]
    .slice(0, 16);
  const apiKey = Netlify.env.get("FINNHUB_API_KEY");

  try {
    const themeResults = await Promise.all(THEMES.map(theme => getGoogleTheme(theme)));
    const articles = themeResults.flat();
    const sources = themeResults.some(items => items.length) ? ["Google News"] : [];

    if (apiKey) {
      const [generalNews, portfolioNews] = await Promise.all([
        getFinnhubGeneral(apiKey),
        getPortfolioNews(expandPortfolioSymbols(requestedSymbols), apiKey)
      ]);
      if (generalNews.length || portfolioNews.length) sources.push("Finnhub");
      articles.push(...generalNews, ...portfolioNews);
    }

    const deduped = deduplicate(articles)
      .map(article => attachTickers(article));
    const news = balanceCategories(deduped).slice(0, 75);

    return json({
      news,
      sources: [...new Set(sources)],
      tickerCoverage: {
        usUniverse: SP500_FALLBACK.length,
        ukUniverse: FTSE100.length,
        ftse100AsOf: FTSE100_AS_OF
      },
      fetchedAt: new Date().toISOString()
    }, 200, 600);
  } catch (error) {
    console.error("News aggregation failed:", error);
    return json({ error: "Worldwide news could not be loaded." }, 502);
  }
};

async function getGoogleTheme(theme) {
  const params = new URLSearchParams({
    q: theme.query,
    hl: "en-GB",
    gl: "GB",
    ceid: "GB:en"
  });

  try {
    const response = await fetch(`${GOOGLE_NEWS_BASE}?${params.toString()}`, {
      headers: {
        "User-Agent": "InvestorIntelligenceDashboard/5.5 personal-use",
        "Accept": "application/rss+xml, application/xml, text/xml"
      }
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseRss(xml, theme.category).slice(0, 15);
  } catch {
    return [];
  }
}

async function getFinnhubGeneral(apiKey) {
  try {
    const response = await fetch(`${FINNHUB_BASE}/news?category=general&minId=0`, {
      headers: { "X-Finnhub-Token": apiKey }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data) ? data : []).slice(0, 30).map(article => ({
      id: `finnhub-general-${article.id || hash(article.url || article.headline)}`,
      headline: cleanText(article.headline),
      summary: cleanText(article.summary),
      source: cleanText(article.source || "Finnhub"),
      datetime: Number(article.datetime) || Math.floor(Date.now() / 1000),
      url: article.url,
      category: classifyFinnhubArticle(article)
    })).filter(article => article.headline && article.url);
  } catch {
    return [];
  }
}

async function getPortfolioNews(symbols, apiKey) {
  if (!symbols.length) return [];
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 5);

  const responses = await Promise.all(symbols.slice(0, 10).map(async symbol => {
    const finnhubSymbol = finnhubCompanyNewsSymbol(symbol);
    if (!finnhubSymbol) return [];

    try {
      const endpoint = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(finnhubSymbol)}&from=${isoDate(from)}&to=${isoDate(today)}`;
      const response = await fetch(endpoint, { headers: { "X-Finnhub-Token": apiKey } });
      if (!response.ok) return [];
      const data = await response.json();
      const market = marketForSymbol(symbol);
      return (Array.isArray(data) ? data : []).slice(0, 8).map(article => ({
        id: `finnhub-company-${article.id || hash(article.url || article.headline)}`,
        headline: cleanText(article.headline),
        summary: cleanText(article.summary),
        source: cleanText(article.source || "Finnhub"),
        datetime: Number(article.datetime) || Math.floor(Date.now() / 1000),
        url: article.url,
        category: "portfolio",
        relatedSymbol: symbol,
        tickers: [{ symbol, market }]
      }));
    } catch {
      return [];
    }
  }));

  return responses.flat().filter(article => article.headline && article.url);
}

function finnhubCompanyNewsSymbol(symbol) {
  const clean = normaliseKnownSymbol(symbol);
  // Finnhub's free company-news coverage is strongest for US listings.
  // Preserve the existing VUAG exception, but avoid wasting calls on most .L symbols.
  if (clean.endsWith(".L") && clean !== "VUAG.L") return "";
  return clean;
}

function parseRss(xml, category) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.map((item, index) => {
    const headline = cleanGoogleTitle(tagText(item, "title"));
    const source = cleanText(tagText(item, "source")) || sourceFromTitle(tagText(item, "title"));
    const pubDate = Date.parse(tagText(item, "pubDate"));
    const link = cleanText(tagText(item, "link"));
    return {
      id: `google-${category}-${hash(link || headline || String(index))}`,
      headline,
      summary: "",
      source: source || "Google News",
      datetime: Number.isFinite(pubDate) ? Math.floor(pubDate / 1000) : Math.floor(Date.now() / 1000),
      url: link,
      category
    };
  }).filter(article => article.headline && article.url);
}

function attachTickers(article) {
  const existing = Array.isArray(article.tickers) ? article.tickers : [];
  const detected = detectCompanyMentions(`${article.headline || ""} ${article.summary || ""}`);
  const merged = new Map();

  for (const item of [...existing, ...detected]) {
    const symbol = normaliseKnownSymbol(typeof item === "string" ? item : item?.symbol);
    if (!symbol) continue;
    const company = COMPANY_BY_SYMBOL.get(symbol);
    merged.set(symbol, {
      symbol,
      market: item?.market || company?.market || marketForSymbol(symbol),
      index: company?.index || ""
    });
  }

  if (article.relatedSymbol) {
    const symbol = normaliseKnownSymbol(article.relatedSymbol);
    if (symbol) merged.set(symbol, {
      symbol,
      market: marketForSymbol(symbol),
      index: COMPANY_BY_SYMBOL.get(symbol)?.index || ""
    });
  }

  const tickers = [...merged.values()].slice(0, 6);
  return {
    ...article,
    tickers,
    relatedSymbol: article.relatedSymbol || tickers[0]?.symbol || ""
  };
}

function detectCompanyMentions(rawText) {
  const text = cleanText(rawText);
  const lower = text.toLowerCase();
  const found = new Map();

  for (const match of text.matchAll(/\$([A-Z]{1,5}(?:[.-][A-Z])?(?:\.L)?)/g)) {
    addKnownSymbol(found, match[1]);
  }
  for (const match of text.matchAll(/\b(?:NASDAQ|NYSE|LSE|LON)\s*:\s*([A-Z]{1,5}(?:[.-][A-Z])?(?:\.L)?)/g)) {
    addKnownSymbol(found, match[1], match[0].startsWith("L") ? "UK" : "US");
  }
  for (const match of text.matchAll(/\(([A-Z]{2,5}(?:[.-][A-Z])?(?:\.L)?)\)/g)) {
    addKnownSymbol(found, match[1]);
  }

  for (const company of COMPANY_UNIVERSE) {
    if (company.aliases.some(alias => lower.includes(alias))) {
      found.set(company.symbol, {
        symbol: company.symbol,
        market: company.market,
        index: company.index
      });
    }
    if (found.size >= 8) break;
  }

  return [...found.values()].slice(0, 6);
}

function addKnownSymbol(found, rawSymbol, marketHint = "") {
  let symbol = normaliseKnownSymbol(rawSymbol);
  if (marketHint === "UK" && !symbol.endsWith(".L")) {
    const london = `${symbol}.L`;
    if (COMPANY_BY_SYMBOL.has(london)) symbol = london;
  }
  const company = COMPANY_BY_SYMBOL.get(symbol);
  if (!company) return;
  found.set(symbol, {
    symbol,
    market: company.market,
    index: company.index
  });
}

function buildCompanyUniverse() {
  const companies = [
    ...SP500_FALLBACK.map(item => ({
      symbol: SYMBOL_FIXES[item.symbol] || item.symbol,
      name: item.name,
      market: "US",
      index: "S&P 500"
    })),
    ...FTSE100
  ];

  const map = new Map();
  for (const company of companies) {
    const symbol = normaliseKnownSymbol(company.symbol);
    const current = map.get(symbol) || {
      symbol,
      name: company.name,
      market: company.market,
      index: company.index,
      aliases: []
    };
    const aliases = [
      ...companyAliases(company.name),
      ...(CURATED_ALIASES[symbol] || [])
    ]
      .map(alias => normaliseAlias(alias))
      .filter(isUsefulAlias);

    current.aliases = [...new Set([...current.aliases, ...aliases])];
    map.set(symbol, current);
  }
  return [...map.values()];
}

function companyAliases(name) {
  const full = cleanText(name)
    .replace(/\bClass\s+[A-Z]\b/gi, "")
    .replace(/\bNon-Voting\b/gi, "")
    .replace(/\bOrd\b.*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const stripped = full
    .replace(/\b(Incorporated|Inc|Corporation|Corp|Company|Co|PLC|Ltd|Limited|Holdings|Holding|Group|REIT|SA|AG)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [full, stripped];
}

function normaliseAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulAlias(alias) {
  if (!alias || alias.length < 3) return false;
  if (!alias.includes(" ") && GENERIC_SINGLE_WORDS.has(alias)) return false;
  if (/^(inc|corp|company|group|holdings|plc|ltd)$/.test(alias)) return false;
  return true;
}

function classifyFinnhubArticle(article) {
  const text = `${article.headline || ""} ${article.summary || ""}`.toLowerCase();
  if (/ftse 100|uk shares|london stock|bank of england|sterling|british stocks/.test(text)) return "ftse100";
  if (/dram|nand|hbm|memory chip|micron|sk hynix|semiconductor/.test(text)) return "memory";
  if (/nvidia|apple|microsoft|alphabet|google|amazon|meta|tesla/.test(text)) return "megacaps";
  if (/federal reserve|bank of england|interest rate|tariff|oil|china|sanction|inflation|treasury/.test(text)) return "macro";
  return "global";
}

function expandPortfolioSymbols(symbols) {
  const expanded = new Set(symbols);
  const sAndPFunds = ["VUAG.L", "VUSA.L", "CSP1.L", "IUSA.L", "SPY", "VOO", "IVV"];
  const nasdaqFunds = ["EQQQ.L", "CNDX.L", "QQQ"];
  const ftseFunds = ["ISF.L", "VUKE.L", "CUKX.L"];
  if (symbols.some(symbol => sAndPFunds.includes(symbol))) expanded.add("SPY");
  if (symbols.some(symbol => nasdaqFunds.includes(symbol))) expanded.add("QQQ");
  if (symbols.some(symbol => ftseFunds.includes(symbol))) expanded.add("ISF.L");
  return [...expanded].slice(0, 16);
}

function deduplicate(articles) {
  const seen = new Set();
  return articles
    .filter(article => isRecentEnough(article.datetime))
    .sort((a, b) => Number(b.datetime) - Number(a.datetime))
    .filter(article => {
      const key = normaliseHeadline(article.headline);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function balanceCategories(articles) {
  const order = ["global", "ftse100", "memory", "megacaps", "macro", "portfolio"];
  const groups = Object.fromEntries(order.map(category => [
    category,
    articles.filter(article => article.category === category)
  ]));
  const result = [];
  let index = 0;
  let added = true;

  while (added && result.length < 75) {
    added = false;
    for (const category of order) {
      if (groups[category][index]) {
        result.push(groups[category][index]);
        added = true;
      }
    }
    index += 1;
  }
  return result;
}

function marketForSymbol(symbol) {
  return String(symbol || "").toUpperCase().endsWith(".L") ? "UK" : "US";
}

function normaliseKnownSymbol(value) {
  let symbol = String(value || "").trim().toUpperCase();
  symbol = symbol.replace(/^LSE:|^LON:/, "");
  symbol = symbol.replace("BT/A.L", "BT-A.L");
  symbol = symbol.replace(/\/(?=\.L$)/, "");
  symbol = SYMBOL_FIXES[symbol] || symbol;
  return symbol;
}

function isRecentEnough(datetime) {
  const timestamp = Number(datetime) > 1e12 ? Number(datetime) : Number(datetime) * 1000;
  return Number.isFinite(timestamp) && timestamp > Date.now() - 8 * 24 * 60 * 60 * 1000;
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim()) : "";
}

function cleanGoogleTitle(value) {
  const text = cleanText(value);
  return text.replace(/\s+-\s+[^-]{2,80}$/, "").trim() || text;
}

function sourceFromTitle(value) {
  const text = cleanText(value);
  const match = text.match(/\s+-\s+([^-]{2,80})$/);
  return match ? match[1].trim() : "";
}

function cleanText(value) {
  return decodeXml(String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseHeadline(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 180);
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function hash(value) {
  let hashValue = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hashValue = ((hashValue << 5) - hashValue) + text.charCodeAt(index);
    hashValue |= 0;
  }
  return Math.abs(hashValue).toString(36);
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
