const SEC_LATEST = "https://www.sec.gov/cgi-bin/browse-edgar";
const FEEDS = [
  { type: "SC 13D", kind: "ownership", kindLabel: "Activist or control-oriented ownership disclosure" },
  { type: "SC 13G", kind: "ownership", kindLabel: "Passive or institutional ownership disclosure" },
  { type: "4", kind: "insider", kindLabel: "Corporate insider ownership transaction" }
];

export default async () => {
  const userAgent = Netlify.env.get("SEC_USER_AGENT");
  if (!userAgent || !userAgent.includes("@")) {
    return json({ error: "SEC_USER_AGENT must identify the app and include a contact email." }, 503);
  }

  try {
    const batches = await Promise.all(FEEDS.map(feed => fetchFeed(feed, userAgent)));
    const signals = batches.flat()
      .sort((a, b) => Number(b.datetime) - Number(a.datetime))
      .slice(0, 36);

    return json({
      signals,
      source: "SEC EDGAR Latest Filings",
      note: "13D/13G and Form 4 are faster event-driven disclosures, but none provides a complete real-time hedge-fund portfolio."
    }, 200, 300);
  } catch (error) {
    console.error("SEC signals failed:", error);
    return json({ error: "Recent SEC filings could not be loaded." }, 502);
  }
};

async function fetchFeed(feed, userAgent) {
  const params = new URLSearchParams({
    action: "getcurrent",
    type: feed.type,
    owner: "include",
    start: "0",
    count: feed.type === "4" ? "20" : "40",
    output: "atom"
  });
  const response = await fetch(`${SEC_LATEST}?${params.toString()}`, {
    headers: {
      "User-Agent": userAgent,
      "Accept": "application/atom+xml, application/xml, text/xml",
      "Accept-Encoding": "gzip, deflate"
    }
  });
  if (!response.ok) throw new Error(`SEC ${feed.type} feed returned ${response.status}`);

  const xml = await response.text();
  return parseEntries(xml, feed);
}

function parseEntries(xml, feed) {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries.map(entry => {
    const rawTitle = tagText(entry, "title");
    const updated = Date.parse(tagText(entry, "updated"));
    const url = linkHref(entry);
    const description = stripHtml(tagText(entry, "summary"));
    const form = formFromTitle(rawTitle) || feed.type;
    const title = rawTitle.replace(new RegExp(`^${escapeRegExp(form)}\\s*-\\s*`, "i"), "").trim();

    return {
      form,
      kind: feed.kind,
      kindLabel: feed.kindLabel,
      title: title || rawTitle || `${feed.type} filing`,
      description: truncate(description, 190),
      url,
      datetime: Number.isFinite(updated) ? Math.floor(updated / 1000) : Math.floor(Date.now() / 1000)
    };
  }).filter(item => item.url);
}

function formFromTitle(title) {
  const match = String(title || "").match(/^(SC 13D\/A|SC 13D|SC 13G\/A|SC 13G|4)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function linkHref(entry) {
  const alternate = entry.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i)
    || entry.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*\/?>/i)
    || entry.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return alternate ? decodeXml(alternate[1]) : "";
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/^<!\\[CDATA\\[|\\]\\]>$/g, "").trim()) : "";
}

function stripHtml(value) {
  return decodeXml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function truncate(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` : "no-store"
    }
  });
}
