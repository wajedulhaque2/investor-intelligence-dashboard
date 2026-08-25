const MANAGERS = {
  berkshire: { name: "Berkshire Hathaway — Warren Buffett", cik: "1067983" },
  pershing: { name: "Pershing Square — Bill Ackman", cik: "1336528" },
  duquesne: { name: "Duquesne Family Office — Stanley Druckenmiller", cik: "1536411" },
  baupost: { name: "Baupost Group — Seth Klarman", cik: "1061768" },
  appaloosa: { name: "Appaloosa — David Tepper", cik: "1656456" },
  soros: { name: "Soros Fund Management", cik: "1029160" },
  bridgewater: { name: "Bridgewater Associates", cik: "1350694" },
  scion: { name: "Scion Asset Management — Michael Burry (archive)", cik: "1649339", archived: true }
};

export default async (request) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "berkshire";
  const manager = MANAGERS[id];
  if (!manager) return json({ error: "Unknown manager." }, 404);

  const userAgent = Netlify.env.get("SEC_USER_AGENT");
  if (!userAgent || !userAgent.includes("@")) {
    return json({ error: "SEC_USER_AGENT must identify the app and include a contact email." }, 503);
  }

  try {
    const submissionData = await getSubmissionData(manager.cik, userAgent);
    const filings = getRecent13Fs(submissionData);
    if (!filings.length) return json({ error: "No 13F filings found." }, 404);

    const latest = await getFilingHoldings(manager.cik, filings[0], userAgent);
    const previous = filings[1]
      ? await getFilingHoldings(manager.cik, filings[1], userAgent)
      : { holdings: [] };

    const changes = compareHoldings(latest.holdings, previous.holdings);
    const totalValue = latest.holdings.reduce((sum, holding) => sum + holding.value, 0);

    return json({
      manager: manager.name,
      archived: Boolean(manager.archived),
      reportDate: filings[0].reportDate,
      filedDate: filings[0].filingDate,
      accessionNumber: filings[0].accessionNumber,
      sourceUrl: latest.sourceUrl,
      totalValue,
      positionCount: latest.holdings.length,
      holdings: latest.holdings
        .sort((a, b) => b.value - a.value)
        .slice(0, 15),
      changes: changes.slice(0, 15),
      recentDisclosures: getRecentDisclosures(manager.cik, submissionData)
    }, 200, 21600);
  } catch (error) {
    console.error(error);
    return json({ error: "SEC filing request failed." }, 502);
  }
};

async function getSubmissionData(cik, userAgent) {
  const padded = cik.padStart(10, "0");
  const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, userAgent);
  return await response.json();
}

function getRecent13Fs(data) {
  const recent = data.filings?.recent;
  if (!recent) return [];

  const filings = [];
  for (let index = 0; index < recent.form.length; index += 1) {
    if (!["13F-HR", "13F-HR/A"].includes(recent.form[index])) continue;
    filings.push({
      form: recent.form[index],
      accessionNumber: recent.accessionNumber[index],
      filingDate: recent.filingDate[index],
      reportDate: recent.reportDate[index],
      primaryDocument: recent.primaryDocument[index]
    });
  }

  const uniqueByReport = new Map();
  filings.forEach(filing => {
    if (!uniqueByReport.has(filing.reportDate) || filing.form.endsWith("/A")) {
      uniqueByReport.set(filing.reportDate, filing);
    }
  });

  return [...uniqueByReport.values()]
    .sort((a, b) => String(b.reportDate).localeCompare(String(a.reportDate)))
    .slice(0, 2);
}

function getRecentDisclosures(cik, data) {
  const recent = data.filings?.recent;
  if (!recent) return [];
  const allowed = new Set(["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A", "4", "13F-HR", "13F-HR/A"]);
  const filings = [];

  for (let index = 0; index < recent.form.length; index += 1) {
    const form = recent.form[index];
    if (!allowed.has(form)) continue;
    const accession = recent.accessionNumber[index];
    const primaryDocument = recent.primaryDocument[index];
    const accessionCompact = String(accession || "").replaceAll("-", "");
    filings.push({
      form,
      filingDate: recent.filingDate[index],
      reportDate: recent.reportDate[index],
      accessionNumber: accession,
      url: primaryDocument
        ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionCompact}/${primaryDocument}`
        : `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionCompact}/`
    });
  }

  return filings
    .sort((a, b) => String(b.filingDate).localeCompare(String(a.filingDate)))
    .slice(0, 12);
}

async function getFilingHoldings(cik, filing, userAgent) {
  const accession = filing.accessionNumber.replaceAll("-", "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}`;
  const indexResponse = await secFetch(`${base}/index.json`, userAgent);
  const index = await indexResponse.json();
  const files = index.directory?.item || [];

  const informationTable = files.find(file =>
    /infotable.*\.xml$/i.test(file.name) ||
    /informationtable.*\.xml$/i.test(file.name)
  ) || files.find(file =>
    /\.xml$/i.test(file.name) &&
    !/primary_doc|form13f/i.test(file.name)
  );

  if (!informationTable) throw new Error(`Information table not found for ${filing.accessionNumber}`);

  const sourceUrl = `${base}/${informationTable.name}`;
  const xmlResponse = await secFetch(sourceUrl, userAgent);
  const xml = await xmlResponse.text();
  return { sourceUrl, holdings: parseInformationTable(xml) };
}

function parseInformationTable(xml) {
  const blocks = xml.match(/<(?:\w+:)?infoTable\b[\s\S]*?<\/(?:\w+:)?infoTable>/gi) || [];
  return blocks.map(block => {
    const valueRaw = numberTag(block, "value");
    return {
      issuer: textTag(block, "nameOfIssuer") || "Unknown issuer",
      classTitle: textTag(block, "titleOfClass"),
      cusip: textTag(block, "cusip"),
      figi: textTag(block, "figi"),
      value: valueRaw,
      shares: numberTag(block, "sshPrnamt"),
      shareType: textTag(block, "sshPrnamtType"),
      putCall: textTag(block, "putCall")
    };
  });
}

function compareHoldings(current, previous) {
  const currentMap = new Map(current.map(item => [holdingKey(item), item]));
  const previousMap = new Map(previous.map(item => [holdingKey(item), item]));
  const changes = [];

  for (const [key, item] of currentMap) {
    const before = previousMap.get(key);
    if (!before) {
      changes.push({ ...item, status: "new", shareChange: item.shares, valueChange: item.value });
      continue;
    }
    const shareChange = item.shares - before.shares;
    const valueChange = item.value - before.value;
    if (shareChange === 0 && valueChange === 0) continue;
    changes.push({
      ...item,
      status: shareChange > 0 ? "increased" : shareChange < 0 ? "decreased" : "value change",
      shareChange,
      valueChange
    });
  }

  for (const [key, item] of previousMap) {
    if (!currentMap.has(key)) {
      changes.push({ ...item, status: "exited", shareChange: -item.shares, valueChange: -item.value });
    }
  }

  return changes.sort((a, b) =>
    Math.abs(b.valueChange || 0) - Math.abs(a.valueChange || 0)
  );
}

function holdingKey(item) {
  return [item.cusip, item.classTitle, item.putCall].map(value => String(value || "").toUpperCase()).join("|");
}

function textTag(block, tag) {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

function numberTag(block, tag) {
  const value = textTag(block, tag).replaceAll(",", "");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function secFetch(url, userAgent) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      "Accept-Encoding": "gzip, deflate",
      "Accept": "application/json, application/xml, text/xml, text/plain, */*"
    }
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status} for ${url}`);
  return response;
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=86400` : "no-store"
    }
  });
}
