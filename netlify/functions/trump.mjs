import { SP500_FALLBACK } from "./_sp500Fallback.mjs";

const TRUMP_ACCOUNT_ID = "107780257626128497";
const TRUTH_BASE = "https://truthsocial.com";
const TRUTH_PROFILE = `${TRUTH_BASE}/@realDonaldTrump`;
const DJT_RADAR_PROFILE = "https://x.com/DJTRadar";
const PUBLIC_RSS_MIRROR = "https://trumpstruth.org/feed";


const EXTRA_STOCKS = [
  { symbol: "DJT", name: "Trump Media & Technology Group", aliases: ["trump media", "trump media & technology", "tmtg", "truth social"] },
  { symbol: "COIN", name: "Coinbase", aliases: ["coinbase"] },
  { symbol: "HOOD", name: "Robinhood", aliases: ["robinhood"] },
  { symbol: "ARM", name: "Arm Holdings", aliases: ["arm holdings"] },
  { symbol: "TSM", name: "Taiwan Semiconductor", aliases: ["taiwan semiconductor", "tsmc"] },
  { symbol: "ASML", name: "ASML", aliases: ["asml"] },
  { symbol: "BABA", name: "Alibaba", aliases: ["alibaba"] },
  { symbol: "NVO", name: "Novo Nordisk", aliases: ["novo nordisk"] },
  { symbol: "RIVN", name: "Rivian", aliases: ["rivian"] },
  { symbol: "LCID", name: "Lucid", aliases: ["lucid motors", "lucid group"] },
  { symbol: "MSTR", name: "Strategy", aliases: ["microstrategy", "strategy inc"] },
  { symbol: "CRCL", name: "Circle Internet Group", aliases: ["circle internet", "circle group"] },
  { symbol: null, name: "SpaceX", aliases: ["spacex"], listed: false }
];

const BRAND_ALIASES = {
  NVDA: ["nvidia"], AMD: ["amd", "advanced micro devices"], MU: ["micron", "micron technology"],
  AAPL: ["apple"], MSFT: ["microsoft"], AMZN: ["amazon"], GOOGL: ["google", "alphabet"],
  META: ["meta platforms", "facebook"], TSLA: ["tesla"], INTC: ["intel"], AVGO: ["broadcom"],
  PLTR: ["palantir"], ORCL: ["oracle"], IBM: ["ibm"], QCOM: ["qualcomm"], CRM: ["salesforce"],
  BA: ["boeing"], LMT: ["lockheed martin"], RTX: ["raytheon", "rtx"], NOC: ["northrop grumman"],
  JPM: ["jpmorgan", "jp morgan"], GS: ["goldman sachs"], BAC: ["bank of america"], C: ["citigroup", "citi"],
  XOM: ["exxon", "exxonmobil"], CVX: ["chevron"], COP: ["conocophillips"],
  WMT: ["walmart"], COST: ["costco"], TGT: ["target corporation"], F: ["ford motor", "ford motors"],
  GM: ["general motors"], DIS: ["walt disney", "disney"], NFLX: ["netflix"],
  PFE: ["pfizer"], LLY: ["eli lilly"], JNJ: ["johnson & johnson"], UNH: ["unitedhealth"],
  CAT: ["caterpillar"], DE: ["john deere", "deere & company"], UBER: ["uber"], ABNB: ["airbnb"]
};

const STOCK_CATALOGUE = buildStockCatalogue();
const STOCK_BY_SYMBOL = new Map(STOCK_CATALOGUE.filter(item => item.symbol).map(item => [item.symbol, item]));

const TOPIC_PATTERNS = [
  { topic: "Tariffs & trade", pattern: /\b(tariffs?|trade deal|trade war|imports?|exports?|china|mexico|canada|customs)\b/i },
  { topic: "Rates & Fed", pattern: /\b(federal reserve|\bfed\b|interest rate|powell|treasury|bond|dollar|inflation)\b/i },
  { topic: "Markets", pattern: /\b(stock|stocks|market|markets|shares|equity|s&p|nasdaq|dow|etf|investment|investor)\b/i },
  { topic: "Energy", pattern: /\b(oil|gas|energy|opec|iran|pipeline|drilling|nuclear|electricity)\b/i },
  { topic: "Defence", pattern: /\b(war|missile|defen[cs]e|nato|ukraine|russia|military|weapons)\b/i },
  { topic: "Chips & tech", pattern: /\b(chip|semiconductor|memory|dram|nand|hbm|nvidia|amd|micron|intel|apple|microsoft|google|alphabet|amazon|meta|tesla)\b/i },
  { topic: "Crypto", pattern: /\b(bitcoin|crypto|digital asset|stablecoin|ethereum)\b/i },
  { topic: "Policy", pattern: /\b(regulation|antitrust|tax|sanction|executive order|subsidy|commerce department)\b/i }
];

export default async () => {
  const attempts = [];

  try {
    const posts = await fetchTruthPosts();
    if (posts.length) {
      return json({
        posts,
        fallback: false,
        source: "Truth Social public feed",
        profileUrl: DJT_RADAR_PROFILE,
        note: "Direct public Truth Social posts are shown below. Open @DJTRadar for Trump trade and investment tracking.",
        fetchedAt: new Date().toISOString()
      }, 200, 180);
    }
    attempts.push("Truth Social returned no posts");
  } catch (error) {
    attempts.push(`Truth Social: ${safeMessage(error)}`);
    console.error("Truth Social direct feed failed:", error);
  }

  try {
    const posts = await fetchPublicMirror();
    if (posts.length) {
      return json({
        posts,
        fallback: true,
        source: "Public Trump-post RSS mirror",
        profileUrl: DJT_RADAR_PROFILE,
        note: "Truth Social did not respond, so posts are being read from a free public RSS mirror. Open @DJTRadar for trade-focused tracking.",
        fetchedAt: new Date().toISOString()
      }, 200, 300);
    }
    attempts.push("RSS mirror returned no posts");
  } catch (error) {
    attempts.push(`RSS mirror: ${safeMessage(error)}`);
    console.error("Trump RSS mirror failed:", error);
  }

  try {
    const posts = await fetchNewsFallback();
    if (posts.length) {
      return json({
        posts,
        fallback: true,
        source: "Recent news coverage",
        profileUrl: DJT_RADAR_PROFILE,
        note: "Direct post sources were unavailable, so this is recent coverage of Trump statements and Truth Social posts from multiple publishers. Open @DJTRadar for trade-focused tracking.",
        fetchedAt: new Date().toISOString()
      }, 200, 300);
    }
    attempts.push("News fallback returned no stories");
  } catch (error) {
    attempts.push(`News fallback: ${safeMessage(error)}`);
    console.error("Trump news fallback failed:", error);
  }

  return json({
    error: "The free Trump sources could not be loaded.",
    profileUrl: DJT_RADAR_PROFILE,
    truthProfileUrl: TRUTH_PROFILE,
    attempts
  }, 502);
};

async function fetchTruthPosts() {
  const headers = {
    "User-Agent": "InvestorIntelligenceDashboard/4.1 personal-use",
    "Accept": "application/json"
  };

  let accountId = TRUMP_ACCOUNT_ID;
  try {
    const lookup = await fetchWithTimeout(`${TRUTH_BASE}/api/v1/accounts/lookup?acct=realDonaldTrump`, { headers }, 9000);
    if (lookup.ok) {
      const account = await lookup.json();
      if (account?.id) accountId = String(account.id);
    }
  } catch {
    accountId = TRUMP_ACCOUNT_ID;
  }

  const endpoint = `${TRUTH_BASE}/api/v1/accounts/${accountId}/statuses?exclude_replies=true&limit=24`;
  const response = await fetchWithTimeout(endpoint, { headers }, 12000);
  if (!response.ok) throw new Error(`returned ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map(normaliseTruthStatus).filter(post => post.text);
}

function normaliseTruthStatus(status) {
  const original = status?.reblog || status || {};
  const text = htmlToText(original.content || "");
  const createdAt = Date.parse(original.created_at || status?.created_at || "");
  return makePost({
    id: String(original.id || status?.id || ""),
    text,
    url: original.url || status?.url || TRUTH_PROFILE,
    datetime: Number.isFinite(createdAt) ? Math.floor(createdAt / 1000) : nowSeconds(),
    source: "Truth Social"
  });
}

async function fetchPublicMirror() {
  const response = await fetchWithTimeout(PUBLIC_RSS_MIRROR, {
    headers: {
      "User-Agent": "InvestorIntelligenceDashboard/4.1 personal-use",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml"
    }
  }, 12000);
  if (!response.ok) throw new Error(`returned ${response.status}`);

  const xml = await response.text();
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 24).map((block, index) => {
    const title = tagText(block, "title");
    const description = tagText(block, "description") || tagText(block, "content") || tagText(block, "summary");
    const text = htmlToText(description || title);
    const link = tagText(block, "link") || linkAttribute(block) || TRUTH_PROFILE;
    const createdAt = Date.parse(tagText(block, "pubDate") || tagText(block, "published") || tagText(block, "updated"));
    return makePost({
      id: tagText(block, "guid") || tagText(block, "id") || `mirror-${index}-${hash(text)}`,
      text,
      url: link,
      datetime: Number.isFinite(createdAt) ? Math.floor(createdAt / 1000) : nowSeconds(),
      source: "Trump post mirror"
    });
  }).filter(post => post.text);
}

async function fetchNewsFallback() {
  const queries = [
    '("Donald Trump" "Truth Social") (tariff OR rates OR oil OR stocks OR chips OR crypto OR trade) when:3d',
    '("Donald Trump" "Truth Social") when:2d'
  ];
  const responses = await Promise.all(queries.map(fetchGoogleNews));
  const seen = new Set();
  return responses.flat()
    .sort((a, b) => b.datetime - a.datetime)
    .filter(post => {
      const key = `${post.text.toLowerCase()}|${post.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 18);
}

async function fetchGoogleNews(query) {
  const params = new URLSearchParams({ q: query, hl: "en-GB", gl: "GB", ceid: "GB:en" });
  const response = await fetchWithTimeout(`https://news.google.com/rss/search?${params.toString()}`, {
    headers: {
      "User-Agent": "InvestorIntelligenceDashboard/4.1 personal-use",
      "Accept": "application/rss+xml, application/xml, text/xml"
    }
  }, 12000);
  if (!response.ok) throw new Error(`Google News returned ${response.status}`);

  const xml = await response.text();
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 16).map(item => {
    const rawTitle = htmlToText(tagText(item, "title"));
    const { headline, publisher } = splitGoogleTitle(rawTitle);
    const createdAt = Date.parse(tagText(item, "pubDate"));
    return makePost({
      id: `news-${hash(`${headline}|${publisher}`)}`,
      text: headline,
      headline,
      url: tagText(item, "link") || DJT_RADAR_PROFILE,
      datetime: Number.isFinite(createdAt) ? Math.floor(createdAt / 1000) : nowSeconds(),
      source: publisher || "Google News"
    });
  }).filter(post => post.text && post.url);
}

function makePost(input) {
  const text = String(input.text || "").trim();
  const topics = TOPIC_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.topic);
  const stockMentions = detectStockMentions(text);
  return {
    ...input,
    text,
    topics: [...new Set(topics)],
    stockMentions,
    marketSensitive: topics.length > 0 || stockMentions.length > 0
  };
}

function buildStockCatalogue() {
  const byKey = new Map();

  for (const holding of SP500_FALLBACK) {
    const symbol = normaliseSymbol(holding.symbol);
    if (!symbol) continue;
    const aliases = new Set([
      cleanCompanyName(holding.name),
      ...(BRAND_ALIASES[symbol] || [])
    ].map(normaliseAlias).filter(isUsefulAlias));
    byKey.set(symbol, {
      symbol,
      name: holding.name,
      listed: true,
      aliases: [...aliases]
    });
  }

  for (const extra of EXTRA_STOCKS) {
    const symbol = normaliseSymbol(extra.symbol);
    const key = symbol || `private:${extra.name.toLowerCase()}`;
    const existing = byKey.get(key);
    const aliases = new Set([
      ...(existing?.aliases || []),
      extra.name,
      ...(extra.aliases || [])
    ].map(normaliseAlias).filter(isUsefulAlias));
    byKey.set(key, {
      symbol,
      name: extra.name,
      listed: extra.listed !== false && Boolean(symbol),
      aliases: [...aliases]
    });
  }

  for (const [symbol, aliases] of Object.entries(BRAND_ALIASES)) {
    const existing = byKey.get(symbol);
    if (!existing) continue;
    existing.aliases = [...new Set([...existing.aliases, ...aliases.map(normaliseAlias).filter(isUsefulAlias)])];
  }

  return [...byKey.values()];
}

function detectStockMentions(text) {
  const lower = ` ${String(text || "").toLowerCase().replace(/[’]/g, "'")} `;
  const found = new Map();

  for (const match of String(text || "").matchAll(/\$([A-Z][A-Z0-9.\-]{0,7})\b/g)) {
    const symbol = normaliseSymbol(match[1]);
    if (!symbol) continue;
    const known = STOCK_BY_SYMBOL.get(symbol);
    found.set(symbol, {
      symbol,
      name: known?.name || symbol,
      listed: true,
      matchedAs: `$${symbol}`
    });
  }

  for (const company of STOCK_CATALOGUE) {
    for (const alias of company.aliases) {
      if (!containsAlias(lower, alias)) continue;
      const key = company.symbol || `private:${company.name.toLowerCase()}`;
      if (!found.has(key)) {
        found.set(key, {
          symbol: company.symbol,
          name: company.name,
          listed: company.listed,
          matchedAs: alias
        });
      }
      break;
    }
  }

  return [...found.values()].slice(0, 8);
}

function containsAlias(haystack, alias) {
  if (!alias) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

function cleanCompanyName(value) {
  return String(value || "")
    .replace(/\b(class [a-z]|holdings?|group|corporation|corp\.?|inc\.?|plc|ltd\.?|limited|company|co\.?|reit)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9' .-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulAlias(alias) {
  if (!alias || alias.length < 3) return false;
  const blocked = new Set(["inc", "corp", "group", "company", "class a", "class b", "the"]);
  return !blocked.has(alias);
}

function normaliseSymbol(value) {
  const symbol = String(value || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  return symbol || null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function htmlToText(value) {
  return decodeXml(String(value || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim()) : "";
}

function linkAttribute(block) {
  const match = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match ? decodeXml(match[1]) : "";
}

function splitGoogleTitle(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*)\s+-\s+([^-]{2,90})$/);
  return match ? { headline: match[1].trim(), publisher: match[2].trim() } : { headline: text, publisher: "Google News" };
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function safeMessage(error) {
  return String(error?.message || "unknown error").replace(/[<>&]/g, "").slice(0, 140);
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

function nowSeconds() { return Math.floor(Date.now() / 1000); }

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` : "no-store"
    }
  });
}
