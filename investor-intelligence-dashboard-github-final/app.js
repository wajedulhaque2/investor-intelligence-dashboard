const state = {
  portfolio: null,
  portfolioSource: "file",
  portfolioSummary: null,
  portfolioWarning: "",
  quotes: {},
  fx: { USD: 0.79, GBP: 1, EUR: 0.86 },
  pulse: [],
  earnings: [],
  earningsWatchlist: [],
  earningsWeekMeta: null,
  earningsDay: "all",
  earningsMarket: "all",
  earningsSearch: "",
  earningsVisibleLimit: 100,
  news: [],
  newsCategory: "all",
  newsSearch: "",
  newsSources: [],
  radarPosts: [],
  radarFallback: false,
  radarQuotes: {},
  radarBaselines: {},
  investor: null,
  investorSignals: [],
  investorSignalType: "all",
  stockResearch: null,
  stockSymbol: "AMD",
  autoRefreshSeconds: 60,
  autoRefreshTimer: null,
  autoRefreshCountdownTimer: null,
  autoRefreshNextAt: 0,
  autoRefreshBusy: false,
  refreshBusy: false
};

const sampleQuotes = {
  AAPL: { c: 218.42, d: 1.82, dp: 0.84, pc: 216.60 },
  MSFT: { c: 512.18, d: -2.34, dp: -0.45, pc: 514.52 },
  GOOGL: { c: 196.34, d: 2.12, dp: 1.09, pc: 194.22 },
  "VUAG.L": { c: 96.08, d: 0.48, dp: 0.50, pc: 95.60 }
};

const sampleEarnings = [
  { symbol: "AMD", market: "US", date: nextDate(6), hour: "amc", epsEstimate: 1.21, revenueEstimate: 8750000000 },
  { symbol: "AAPL", market: "US", date: nextDate(8), hour: "amc", epsEstimate: 1.54, revenueEstimate: 89200000000 },
  { symbol: "AZN.L", companyName: "AstraZeneca PLC", market: "UK", index: "FTSE 100", date: nextDate(10), hour: "bmo", epsEstimate: null },
  { symbol: "MSFT", market: "US", date: nextDate(14), hour: "amc", epsEstimate: 3.32, revenueEstimate: 73800000000 }
];

const sampleInvestor = {
  manager: "Berkshire Hathaway — Warren Buffett",
  reportDate: "Latest SEC filing loads locally",
  filedDate: "SEC live endpoint",
  totalValue: null,
  positionCount: null,
  holdings: [
    { issuer: "Live SEC data", classTitle: "Configure SEC_USER_AGENT", value: null, shares: null },
    { issuer: "No paid data provider required", classTitle: "Source: SEC EDGAR", value: null, shares: null }
  ],
  changes: [
    { issuer: "Quarter comparison", status: "ready", shareChange: null, valueChange: null }
  ]
};

document.addEventListener("DOMContentLoaded", initialise);

async function initialise() {
  setHeaderLabels();
  bindControls();
  highlightNavigation();

  await loadPortfolio();
  await loadEarningsWatchlist();
  await Promise.all([
    loadMarketData(),
    loadNews(),
    loadRadar(),
    loadStockResearch("AMD"),
    loadInvestor("berkshire"),
    loadInvestorSignals()
  ]);
  markRefresh();
  initialiseAutoRefresh();
}

function setHeaderLabels() {
  const now = new Date();
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
  }).format(now);

  const hour = now.getHours();
  document.querySelector("#greeting").textContent = hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}

function bindControls() {
  document.querySelector("#refresh-button").addEventListener("click", refreshAll);
  document.querySelector("#auto-refresh-select")?.addEventListener("change", event => {
    setAutoRefresh(Number(event.target.value));
  });
  document.querySelector("#investor-select").addEventListener("change", event => loadInvestor(event.target.value));
  document.querySelector("#trump-market-only").addEventListener("change", renderRadar);
  document.querySelector("#trump-feed").addEventListener("click", event => {
    const link = event.target.closest("[data-radar-symbol]");
    if (!link) return;
    event.preventDefault();
    const symbol = link.dataset.radarSymbol;
    if (!symbol) return;
    document.querySelector("#stock-symbol").value = symbol;
    loadStockResearch(symbol);
    document.querySelector("#stock-explorer").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector("#earnings-search").addEventListener("input", event => {
    state.earningsSearch = event.target.value.trim().toLowerCase();
    state.earningsVisibleLimit = 100;
    renderEarnings();
  });
  document.querySelector("#earnings-day").addEventListener("change", event => {
    state.earningsDay = event.target.value || "all";
    state.earningsVisibleLimit = 100;
    renderEarnings();
  });
  document.querySelector("#earnings-market").addEventListener("change", event => {
    state.earningsMarket = event.target.value || "all";
    state.earningsVisibleLimit = 100;
    renderEarnings();
  });

  document.querySelector("#earnings-more")?.addEventListener("click", () => {
    state.earningsVisibleLimit += 100;
    renderEarnings();
  });

  document.querySelectorAll("[data-signal-type]").forEach(button => {
    button.addEventListener("click", () => {
      state.investorSignalType = button.dataset.signalType || "all";
      document.querySelectorAll("[data-signal-type]").forEach(item => {
        item.classList.toggle("active", item === button);
      });
      renderInvestorSignals();
    });
  });

  document.querySelectorAll("[data-news-category]").forEach(button => {
    button.addEventListener("click", () => {
      state.newsCategory = button.dataset.newsCategory || "all";
      document.querySelectorAll("[data-news-category]").forEach(item => {
        item.classList.toggle("active", item === button);
      });
      renderNews();
    });
  });

  document.querySelector("#news-search").addEventListener("input", event => {
    state.newsSearch = event.target.value.trim().toLowerCase();
    renderNews();
  });

  document.querySelector("#stock-explorer-form").addEventListener("submit", event => {
    event.preventDefault();
    const symbol = document.querySelector("#stock-symbol").value.trim().toUpperCase();
    if (symbol) loadStockResearch(symbol);
  });

  document.querySelectorAll("[data-explorer-symbol]").forEach(button => {
    button.addEventListener("click", () => {
      const symbol = button.dataset.explorerSymbol;
      document.querySelector("#stock-symbol").value = symbol;
      loadStockResearch(symbol);
    });
  });
}

async function refreshAll() {
  if (state.refreshBusy || state.autoRefreshBusy) return;
  state.refreshBusy = true;

  const button = document.querySelector("#refresh-button");
  button.disabled = true;
  button.textContent = "Refreshing…";

  try {
    await loadPortfolio();
    await loadEarningsWatchlist();
    await Promise.all([
      loadMarketData(),
      loadNews(),
      loadRadar(),
      loadStockResearch(state.stockSymbol || "AMD"),
      loadInvestor(document.querySelector("#investor-select").value),
      loadInvestorSignals()
    ]);

    markRefresh();
  } finally {
    state.refreshBusy = false;
    button.disabled = false;
    button.textContent = "Refresh data";
    scheduleAutoRefresh();
  }
}

function initialiseAutoRefresh() {
  let saved = 60;
  try {
    const stored = Number(window.localStorage.getItem("dashboardAutoRefreshSeconds"));
    if ([0, 30, 60].includes(stored)) saved = stored;
  } catch {
    saved = 60;
  }

  const select = document.querySelector("#auto-refresh-select");
  if (select) select.value = String(saved);
  setAutoRefresh(saved);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.autoRefreshSeconds > 0) scheduleAutoRefresh();
  });
}

function setAutoRefresh(seconds) {
  state.autoRefreshSeconds = [30, 60].includes(Number(seconds)) ? Number(seconds) : 0;
  try {
    window.localStorage.setItem("dashboardAutoRefreshSeconds", String(state.autoRefreshSeconds));
  } catch {
    // The dashboard still works when browser storage is unavailable.
  }

  const select = document.querySelector("#auto-refresh-select");
  if (select) select.value = String(state.autoRefreshSeconds);
  scheduleAutoRefresh();
}

function scheduleAutoRefresh() {
  window.clearTimeout(state.autoRefreshTimer);
  window.clearInterval(state.autoRefreshCountdownTimer);

  if (!state.autoRefreshSeconds) {
    state.autoRefreshNextAt = 0;
    updateAutoRefreshStatus("Off");
    return;
  }

  state.autoRefreshNextAt = Date.now() + state.autoRefreshSeconds * 1000;
  updateAutoRefreshCountdown();
  state.autoRefreshCountdownTimer = window.setInterval(updateAutoRefreshCountdown, 1000);
  state.autoRefreshTimer = window.setTimeout(runAutoRefresh, state.autoRefreshSeconds * 1000);
}

async function runAutoRefresh() {
  if (!state.autoRefreshSeconds) return;

  if (document.hidden || state.refreshBusy || state.autoRefreshBusy) {
    scheduleAutoRefresh();
    return;
  }

  state.autoRefreshBusy = true;
  updateAutoRefreshStatus("Refreshing…");

  try {
    // Fast-changing panels only: account, quotes, market pulse and Trump mentions.
    // News, weekly earnings and SEC filings remain on the full Refresh data button.
    await loadPortfolio();
    await Promise.all([
      loadMarketData({ includeEarnings: false }),
      loadRadar()
    ]);
    markRefresh("Auto-refreshed");
  } catch (error) {
    console.error("Auto refresh failed", error);
    updateAutoRefreshStatus("Retrying…");
  } finally {
    state.autoRefreshBusy = false;
    scheduleAutoRefresh();
  }
}

function updateAutoRefreshCountdown() {
  if (!state.autoRefreshSeconds || !state.autoRefreshNextAt) {
    updateAutoRefreshStatus("Off");
    return;
  }
  const secondsLeft = Math.max(0, Math.ceil((state.autoRefreshNextAt - Date.now()) / 1000));
  updateAutoRefreshStatus(`Next in ${secondsLeft}s`);
}

function updateAutoRefreshStatus(text) {
  const status = document.querySelector("#auto-refresh-status");
  if (status) status.textContent = text;
}

async function loadPortfolio() {
  state.portfolioWarning = "";
  hidePortfolioWarning();

  try {
    const response = await fetch("/.netlify/functions/trading212", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Trading 212 portfolio could not be loaded.");
    }

    state.portfolioSource = "trading212";
    state.portfolioSummary = data.summary || null;
    state.portfolio = {
      baseCurrency: data.accountCurrency || "GBP",
      holdings: (data.holdings || []).map(holding => ({
        ...holding,
        shares: Number(holding.shares || 0),
        averageCost: Number(holding.averageCost || 0),
        currentPrice: Number(holding.currentPrice || 0),
        account: holding.account || "Trading 212"
      }))
    };
    updatePortfolioCount();
    return;
  } catch (error) {
    state.portfolioWarning = `${error.message} Using demo portfolio data instead.`;
  }

  try {
    const response = await fetch("/data/portfolio.example.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Portfolio file not found.");
    state.portfolio = await response.json();
    state.portfolioSource = "file";
    state.portfolioSummary = null;
    updatePortfolioCount();
    showPortfolioWarning(state.portfolioWarning);
  } catch (error) {
    state.portfolio = { baseCurrency: "GBP", holdings: [] };
    state.portfolioSource = "none";
    state.portfolioSummary = null;
    state.portfolioWarning = `${state.portfolioWarning} ${error.message}`.trim();
    updatePortfolioCount();
    showPortfolioWarning(state.portfolioWarning);
  }
}

function updatePortfolioCount() {
  const count = state.portfolio?.holdings?.length || 0;
  const source = state.portfolioSource === "trading212" ? "Trading 212" : "local file";
  document.querySelector("#portfolio-count").textContent =
    `${count} position${count === 1 ? "" : "s"} · ${source}`;
}

function portfolioSymbols() {
  return [...new Set(
    (state.portfolio?.holdings || [])
      .map(item => item.marketSymbol || item.symbol)
      .filter(Boolean)
  )];
}

async function loadEarningsWatchlist() {
  try {
    const response = await fetch("/data/earnings-watchlist.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Earnings watchlist file unavailable.");
    const data = await response.json();
    state.earningsWatchlist = Array.isArray(data.companies) ? data.companies : [];
    state.earningsUniverse = data.universe || "sp500";
    state.earningsWindowDays = Math.min(120, Math.max(30, Number(data.windowDays) || 90));
  } catch {
    state.earningsWatchlist = [
      { symbol: "AMD", name: "AMD", category: "semiconductors" },
      { symbol: "NVDA", name: "Nvidia", category: "semiconductors" },
      { symbol: "MU", name: "Micron", category: "semiconductors" },
      { symbol: "AAPL", name: "Apple", category: "megacaps" },
      { symbol: "MSFT", name: "Microsoft", category: "megacaps" },
      { symbol: "AMZN", name: "Amazon", category: "megacaps" }
    ];
    state.earningsUniverse = "sp500";
    state.earningsWindowDays = 90;
  }
}

async function loadMarketData({ includeEarnings = true } = {}) {
  const symbols = portfolioSymbols();
  let finnhubLive = false;
  let quoteRequestFailed = false;

  if (symbols.length) {
    try {
      const quoteResponse = await fetch(`/.netlify/functions/market?view=quotes&symbols=${encodeURIComponent(symbols.join(","))}`);
      if (quoteResponse.ok) {
        const data = await quoteResponse.json();
        state.quotes = data.quotes || {};
        state.fx = data.fx || state.fx;
        finnhubLive = Object.keys(state.quotes).length > 0;
      } else {
        quoteRequestFailed = true;
        state.quotes = {};
      }
    } catch {
      quoteRequestFailed = true;
      state.quotes = {};
    }
  }

  try {
    const pulseResponse = await fetch("/.netlify/functions/market?view=pulse");
    if (pulseResponse.ok) {
      const data = await pulseResponse.json();
      state.pulse = data.pulse || [];
      finnhubLive = finnhubLive || state.pulse.some(item => Number(item.quote?.c) > 0);
    } else {
      state.pulse = [];
    }
  } catch {
    state.pulse = [];
  }

  let earningsLoaded = Boolean(state.earnings.length);
  if (includeEarnings) {
    const earningsStatus = document.querySelector("#earnings-status");
    earningsStatus.textContent = "Loading US and FTSE 100 earnings for the current week…";

    earningsLoaded = false;
    try {
      const earningsResponse = await fetch("/.netlify/functions/weekly-earnings", { cache: "no-store" });
      if (earningsResponse.ok) {
        const data = await earningsResponse.json();
        state.earnings = Array.isArray(data.earnings) ? data.earnings : [];
        state.earningsWeekMeta = data;
        populateEarningsDayOptions();
        earningsLoaded = true;
      } else {
        state.earnings = sampleEarnings;
        state.earningsWeekMeta = null;
      }
    } catch {
      state.earnings = sampleEarnings;
      state.earningsWeekMeta = null;
    }
  }

  if (quoteRequestFailed && state.portfolioSource !== "trading212") {
    state.quotes = sampleQuotes;
  }
  if (!earningsLoaded && !state.earnings.length) state.earnings = sampleEarnings;

  renderPortfolio();
  renderPulse();
  if (includeEarnings) renderEarnings();
  setDataStatus(finnhubLive);
}

async function loadNews() {
  const symbols = portfolioSymbols();
  const status = document.querySelector("#news-status");
  status.textContent = "Loading global and thematic news…";

  try {
    const response = await fetch(`/.netlify/functions/news?symbols=${encodeURIComponent(symbols.join(","))}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "News feed unavailable.");

    state.news = Array.isArray(data.news) ? data.news : [];
    state.newsSources = Array.isArray(data.sources) ? data.sources : [];
    status.textContent = state.news.length
      ? `${state.news.length} stories · ${state.newsSources.join(" + ") || "live sources"}`
      : "No stories were returned.";
  } catch (error) {
    state.news = [];
    state.newsSources = [];
    status.textContent = `${error.message} Refresh to try again.`;
  }

  renderNews();
}

async function loadRadar() {
  const feed = document.querySelector("#trump-feed");
  feed.innerHTML = `<div class="empty-state">Loading posts…</div>`;

  try {
    const response = await fetch("/.netlify/functions/trump", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Trump feed unavailable.");

    state.radarPosts = Array.isArray(data.posts) ? data.posts : [];
    state.radarFallback = Boolean(data.fallback);
    document.querySelector("#trump-source-note").textContent = data.note ||
      "Uses direct public posts where available and switches to backup sources automatically.";
    await loadRadarQuotes();
  } catch (error) {
    state.radarPosts = [];
    state.radarFallback = true;
    state.radarQuotes = {};
    state.radarBaselines = readRadarBaselines();
    document.querySelector("#trump-source-note").textContent =
      `${error.message} Open @DJTRadar for the latest public trade tracking.`;
  }

  renderRadar();
}

async function loadRadarQuotes() {
  const symbols = [...new Set(state.radarPosts.flatMap(post =>
    (post.stockMentions || []).filter(item => item.listed && item.symbol).map(item => item.symbol)
  ))].slice(0, 25);

  state.radarQuotes = {};
  state.radarBaselines = readRadarBaselines();
  if (!symbols.length) return;

  try {
    const response = await fetch(`/.netlify/functions/market?view=quotes&symbols=${encodeURIComponent(symbols.join(","))}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Quote lookup unavailable.");
    state.radarQuotes = data.quotes || {};
    updateRadarBaselines();
  } catch {
    state.radarQuotes = {};
  }
}

function updateRadarBaselines() {
  const baselines = readRadarBaselines();
  const latestBySymbol = new Map();

  [...state.radarPosts]
    .sort((a, b) => Number(b.datetime || 0) - Number(a.datetime || 0))
    .forEach(post => {
      (post.stockMentions || []).forEach(mention => {
        if (!mention.listed || !mention.symbol || latestBySymbol.has(mention.symbol)) return;
        latestBySymbol.set(mention.symbol, post);
      });
    });

  for (const [symbol, post] of latestBySymbol) {
    const quote = state.radarQuotes[symbol];
    const price = Number(quote?.c);
    if (!Number.isFinite(price) || price <= 0) continue;
    const mentionId = String(post.id || `${symbol}-${post.datetime || 0}`);
    const existing = baselines[symbol];
    if (!existing || existing.mentionId !== mentionId) {
      baselines[symbol] = {
        mentionId,
        price,
        detectedAt: Date.now(),
        postTime: Number(post.datetime || 0)
      };
    }
  }

  state.radarBaselines = baselines;
  try {
    localStorage.setItem("investor-intelligence-trump-stock-baselines-v1", JSON.stringify(baselines));
  } catch {}
}

function readRadarBaselines() {
  try {
    const parsed = JSON.parse(localStorage.getItem("investor-intelligence-trump-stock-baselines-v1") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function loadInvestorSignals() {
  const status = document.querySelector("#signals-status");
  status.textContent = "Loading recent SEC filings…";

  try {
    const response = await fetch("/.netlify/functions/signals", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "SEC signals unavailable.");
    state.investorSignals = Array.isArray(data.signals) ? data.signals : [];
    status.textContent = state.investorSignals.length
      ? `${state.investorSignals.length} recent filings · SEC EDGAR`
      : "No recent filings returned.";
  } catch (error) {
    state.investorSignals = [];
    status.textContent = error.message;
  }

  renderInvestorSignals();
}

async function loadStockResearch(symbol) {
  const cleanSymbol = String(symbol || "AMD").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (!cleanSymbol) return;

  state.stockSymbol = cleanSymbol;
  state.stockResearch = null;
  document.querySelector("#stock-symbol").value = cleanSymbol;
  document.querySelector("#stock-explorer-status").textContent = `Loading ${cleanSymbol} fundamentals…`;
  document.querySelector("#explorer-company").hidden = true;
  document.querySelector("#fundamental-grid").innerHTML = `<div class="empty-state">Loading market statistics…</div>`;

  try {
    const response = await fetch(`/.netlify/functions/market?view=fundamentals&symbols=${encodeURIComponent(cleanSymbol)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Fundamentals could not be loaded.");
    state.stockResearch = data;
    renderStockResearch();
  } catch (error) {
    document.querySelector("#stock-explorer-status").textContent = error.message;
    document.querySelector("#fundamental-grid").innerHTML = `<div class="empty-state">${escapeHtml(error.message)} Try a US ticker such as AMD, NVDA or MU.</div>`;
  }
}

function renderStockResearch() {
  const data = state.stockResearch;
  if (!data) return;

  const profile = data.profile || {};
  const quote = data.quote || {};
  const metrics = data.metrics || {};
  const symbol = data.symbol || state.stockSymbol;
  const company = document.querySelector("#explorer-company");
  company.hidden = false;

  document.querySelector("#explorer-symbol").textContent = symbol;
  document.querySelector("#explorer-name").textContent = profile.name || symbol;
  document.querySelector("#explorer-meta").textContent = [profile.industry, profile.exchange, profile.currency].filter(Boolean).join(" · ") || "Company fundamentals";
  document.querySelector("#explorer-price").textContent = marketMoney(quote.c, profile.currency || "USD");

  const dayChange = Number(quote.dp);
  const dayNode = document.querySelector("#explorer-day-change");
  if (Number.isFinite(dayChange)) {
    dayNode.textContent = `${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}% today`;
    dayNode.className = dayChange >= 0 ? "positive" : "negative";
  } else {
    dayNode.textContent = "Day move unavailable";
    dayNode.className = "neutral";
  }

  const cards = [
    metricCard("Market cap", compactCurrency(metrics.marketCap, profile.currency || "USD"), assessMarketCap(metrics.marketCap),
      "Company size, not whether the shares are cheap. Larger firms are usually more established; smaller firms can offer more growth but often carry more risk."),
    metricCard("Average volume", compactShares(metrics.averageVolume10d), assessLiquidity(metrics.averageVolume10d, quote.c),
      "Average shares traded per day over roughly 10 sessions. Higher dollar volume usually means easier entry and exit with tighter spreads."),
    metricCard("P/E ratio", formatRatio(metrics.peTtm), assessPe(metrics.peTtm),
      "Price divided by trailing earnings per share. A negative P/E means earnings are negative, so the ratio is not a useful valuation measure."),
    metricCard("Dividend yield", formatYield(metrics.dividendYield), assessYield(metrics.dividendYield),
      "Expected annual dividend divided by the share price. A very high yield can be a warning if profits and cash flow do not support the payout."),
    metricCard("52-week position", formatRangePosition(quote.c, metrics.week52Low, metrics.week52High), assessRange(quote.c, metrics.week52Low, metrics.week52High),
      "Shows where the current price sits between its 52-week low and high. Being near a high is not automatically expensive; being near a low is not automatically cheap."),
    metricCard("Beta", formatRatio(metrics.beta), assessBeta(metrics.beta),
      "A rough measure of sensitivity to the overall market. Around 1 means market-like movement; above 1 usually means larger swings."),
    metricCard("Price / book", formatRatio(metrics.priceToBook), assessPriceToBook(metrics.priceToBook),
      "Price compared with accounting book value. It is more useful for banks and asset-heavy firms than for software or brand-led businesses."),
    metricCard("Revenue growth", formatGrowth(metrics.revenueGrowth), assessGrowth(metrics.revenueGrowth),
      "Year-on-year revenue growth. Growth is more valuable when margins and cash generation are also improving."),
  ];

  document.querySelector("#fundamental-grid").innerHTML = cards.join("");
  document.querySelector("#stock-explorer-status").textContent = data.asOf
    ? `Fundamentals refreshed ${relativeTime(new Date(data.asOf).getTime())}. Heuristics are educational, not buy or sell signals.`
    : "Heuristics are educational, not buy or sell signals.";
}

function metricCard(label, value, assessment, explanation) {
  return `
    <article class="fundamental-card">
      <div class="fundamental-topline"><span>${escapeHtml(label)}</span><span class="assessment-badge ${escapeHtml(assessment.tone)}">${escapeHtml(assessment.label)}</span></div>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(explanation)}</p>
      <small>${escapeHtml(assessment.note)}</small>
    </article>`;
}

function assessMarketCap(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return assessment("Unavailable", "neutral", "Market-cap data was not returned.");
  if (number >= 200e9) return assessment("Mega-cap", "positive", "Very large company; size can reduce business risk but does not guarantee a fair valuation.");
  if (number >= 10e9) return assessment("Large-cap", "positive", "Established scale; compare growth and valuation with similar large companies.");
  if (number >= 2e9) return assessment("Mid-cap", "warning", "Potentially faster growth, usually with more volatility and execution risk.");
  if (number >= 300e6) return assessment("Small-cap", "warning", "Higher company-specific and liquidity risk is common.");
  return assessment("Micro-cap", "negative", "Very high company-specific and liquidity risk can apply.");
}

function assessLiquidity(volume, price) {
  const shares = Number(volume);
  const stockPrice = Number(price);
  if (!Number.isFinite(shares) || shares <= 0) return assessment("Unavailable", "neutral", "Volume data was not returned.");
  const dollarVolume = shares * (Number.isFinite(stockPrice) ? stockPrice : 0);
  if (dollarVolume >= 100e6) return assessment("Highly liquid", "positive", `${compactCurrency(dollarVolume, "USD")} estimated daily value traded.`);
  if (dollarVolume >= 20e6) return assessment("Liquid", "positive", `${compactCurrency(dollarVolume, "USD")} estimated daily value traded.`);
  if (dollarVolume >= 5e6) return assessment("Moderate", "warning", "Use limit orders and check the bid–ask spread.");
  return assessment("Thin", "negative", "Lower liquidity can mean wider spreads and greater price impact.");
}

function assessPe(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return assessment("Unavailable", "neutral", "No meaningful trailing P/E was returned.");
  if (number < 0) return assessment("Loss-making", "negative", "Negative earnings make P/E unsuitable; examine revenue, margins, cash flow and the path to profitability.");
  if (number < 15) return assessment("Low multiple", "positive", "Could indicate value, slow growth, cyclicality or elevated risk—check why it is low.");
  if (number <= 25) return assessment("Moderate", "positive", "Often compatible with mature profitable firms, but sector and growth still matter.");
  if (number <= 40) return assessment("Growth premium", "warning", "Investors are paying for above-average future growth.");
  return assessment("High expectations", "negative", "The company may need strong and durable growth to justify the valuation.");
}

function assessYield(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return assessment("No/low payout", "neutral", "The company may retain cash for growth, or no yield data was available.");
  if (number < 1) return assessment("Low yield", "neutral", "Income is limited; total return may depend mainly on growth.");
  if (number < 3) return assessment("Moderate yield", "positive", "A common income range for profitable large companies.");
  if (number < 6) return assessment("High yield", "warning", "Check payout ratio, free cash flow and dividend history.");
  return assessment("Very high yield", "negative", "The market may be pricing in a dividend cut or business stress.");
}

function assessRange(price, low, high) {
  const pct = rangePercent(price, low, high);
  if (pct === null) return assessment("Unavailable", "neutral", "A complete 52-week range was not returned.");
  if (pct >= 80) return assessment("Near yearly high", "warning", "Strong momentum, but expectations may be elevated.");
  if (pct <= 20) return assessment("Near yearly low", "warning", "Could be opportunity or deterioration; investigate the cause.");
  return assessment("Mid-range", "neutral", "Price is away from both yearly extremes.");
}

function assessBeta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return assessment("Unavailable", "neutral", "Beta data was not returned.");
  if (number < 0.8) return assessment("Lower sensitivity", "positive", "Historically moved less than the broad market, though this can change.");
  if (number <= 1.2) return assessment("Market-like", "neutral", "Historically moved broadly in line with the market.");
  return assessment("Higher volatility", "warning", "Historically amplified market moves in both directions.");
}

function assessPriceToBook(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return assessment("Unavailable", "neutral", "Book-value comparison is unavailable or not meaningful.");
  if (number < 1) return assessment("Below book", "warning", "Can signal undervaluation, weak assets or expected losses.");
  if (number <= 3) return assessment("Moderate", "positive", "Often reasonable for asset-heavy firms; compare within the same industry.");
  return assessment("Premium to book", "warning", "Common for high-return or intangible-heavy businesses; less useful for software firms.");
}

function assessGrowth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return assessment("Unavailable", "neutral", "Revenue-growth data was not returned.");
  if (number < 0) return assessment("Contracting", "negative", "Revenue is declining; determine whether this is cyclical or structural.");
  if (number < 5) return assessment("Slow growth", "neutral", "Valuation should usually reflect modest expansion.");
  if (number < 15) return assessment("Healthy growth", "positive", "Useful when margins and cash flow are stable or improving.");
  return assessment("Fast growth", "warning", "Attractive if durable, but high-growth shares often carry demanding valuations.");
}

function assessment(label, tone, note) { return { label, tone, note }; }

function formatRatio(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "—";
}

function formatYield(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${number.toFixed(2)}%` : "—";
}

function formatGrowth(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number.toFixed(1)}%` : "—";
}

function compactCurrency(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency === "GBX" ? "GBP" : currency, notation: "compact", maximumFractionDigits: 2 }).format(number);
}

function compactShares(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(number)} shares`;
}

function marketMoney(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency === "GBX" ? "GBP" : currency, maximumFractionDigits: 2 }).format(currency === "GBX" ? number / 100 : number);
}

function rangePercent(price, low, high) {
  const current = Number(price), bottom = Number(low), top = Number(high);
  if (![current, bottom, top].every(Number.isFinite) || top <= bottom) return null;
  return Math.max(0, Math.min(100, ((current - bottom) / (top - bottom)) * 100));
}

function formatRangePosition(price, low, high) {
  const pct = rangePercent(price, low, high);
  return pct === null ? "—" : `${pct.toFixed(0)}% of range`;
}

function renderPortfolio() {
  const body = document.querySelector("#portfolio-body");
  body.innerHTML = "";
  const baseCurrency = state.portfolio?.baseCurrency || "GBP";

  const positions = (state.portfolio?.holdings || []).map(holding => {
    const marketSymbol = holding.marketSymbol || holding.symbol;
    const quote = state.quotes[marketSymbol] || {};
    const price = firstFinite(holding.currentPrice, quote.c, holding.averageCost, 0);
    const fx = state.fx[holding.currency] ?? (holding.currency === baseCurrency ? 1 : null);
    const calculatedValue = fx === null ? null : holding.shares * price * fx;
    const calculatedCost = fx === null ? null : holding.shares * Number(holding.averageCost || 0) * fx;
    const value = firstFinite(holding.value, calculatedValue, 0);
    const cost = firstFinite(holding.cost, calculatedCost, 0);
    const dayPct = Number.isFinite(Number(quote.dp)) ? Number(quote.dp) : null;
    const dayValue = dayPct === null ? null : value * (dayPct / (100 + dayPct));

    return { holding, price, value, cost, dayPct, dayValue };
  });

  const calculatedTotalValue = positions.reduce((sum, position) => sum + finiteOrZero(position.value), 0);
  const calculatedTotalCost = positions.reduce((sum, position) => sum + finiteOrZero(position.cost), 0);
  const investedValue = firstFinite(state.portfolioSummary?.currentValue, calculatedTotalValue, 0);
  const totalCost = firstFinite(state.portfolioSummary?.totalCost, calculatedTotalCost, 0);
  const cashAvailable = firstFinite(state.portfolioSummary?.cashAvailable, 0);
  const accountValue = firstFinite(state.portfolioSummary?.totalAccountValue, investedValue + cashAvailable, investedValue);
  const unrealizedProfitLoss = firstFinite(
    state.portfolioSummary?.unrealizedProfitLoss,
    investedValue - totalCost,
    0
  );
  const realizedProfitLoss = firstFinite(state.portfolioSummary?.realizedProfitLoss, 0);
  const maxReturn = realizedProfitLoss + unrealizedProfitLoss;
  const openReturnPct = totalCost ? (unrealizedProfitLoss / totalCost) * 100 : null;
  const totalValue = investedValue;

  const dailyPositions = positions.filter(position => position.dayValue !== null);
  const dayValue = dailyPositions.reduce((sum, position) => sum + position.dayValue, 0);
  const dayPrevious = dailyPositions.reduce((sum, position) => sum + position.value - position.dayValue, 0);
  const dayPct = dayPrevious ? (dayValue / dayPrevious) * 100 : null;

  document.querySelector("#portfolio-value").textContent = money(accountValue, baseCurrency);
  document.querySelector("#portfolio-cost").textContent = `${money(investedValue, baseCurrency)} invested · ${money(cashAvailable, baseCurrency)} cash`;
  document.querySelector("#max-return").textContent = signedMoney(maxReturn, baseCurrency);
  document.querySelector("#max-return").className = maxReturn >= 0 ? "positive" : "negative";
  document.querySelector("#max-return-detail").textContent = openReturnPct === null
    ? `Includes ${signedMoney(realizedProfitLoss, baseCurrency)} realised`
    : `Open return ${openReturnPct >= 0 ? "+" : ""}${openReturnPct.toFixed(2)}% · ${signedMoney(realizedProfitLoss, baseCurrency)} realised`;
  document.querySelector("#portfolio-pnl").textContent = signedMoney(unrealizedProfitLoss, baseCurrency);
  document.querySelector("#portfolio-pnl").className = unrealizedProfitLoss >= 0 ? "positive" : "negative";
  document.querySelector("#portfolio-source-label").textContent =
    state.portfolioSource === "trading212" ? "From your Trading 212 account" : "From demo portfolio data";

  if (dayPct === null) {
    document.querySelector("#day-change").textContent = "—";
    document.querySelector("#day-change").className = "neutral";
    document.querySelector("#day-change-value").textContent = "No matching day quotes";
  } else {
    document.querySelector("#day-change").textContent = `${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}%`;
    document.querySelector("#day-change").className = dayPct >= 0 ? "positive" : "negative";
    document.querySelector("#day-change-value").textContent = signedMoney(dayValue, baseCurrency);
  }

  positions
    .sort((a, b) => b.value - a.value)
    .forEach(({ holding, price, value, dayPct: holdingDayPct }) => {
      const allocation = totalValue ? (value / totalValue) * 100 : 0;
      const symbol = holding.marketSymbol || holding.symbol || holding.brokerTicker || "—";
      const dayClass = holdingDayPct > 0 ? "positive" : holdingDayPct < 0 ? "negative" : "neutral";
      const dayLabel = holdingDayPct === null ? "—" : `${holdingDayPct > 0 ? "+" : ""}${holdingDayPct.toFixed(2)}%`;
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>
          <div class="asset-cell">
            <span class="asset-icon">${escapeHtml(symbol.slice(0, 3))}</span>
            <span><strong>${escapeHtml(holding.name)}</strong><small>${escapeHtml(symbol)}${holding.brokerTicker && holding.brokerTicker !== symbol ? ` · ${escapeHtml(holding.brokerTicker)}` : ""}</small></span>
          </div>
        </td>
        <td>${escapeHtml(holding.account || "—")}</td>
        <td>${money(price, holding.currency || baseCurrency)}</td>
        <td class="${dayClass}">${dayLabel}</td>
        <td>${money(value, baseCurrency)}</td>
        <td>
          <div class="allocation">
            <div class="allocation-label"><span>${allocation.toFixed(1)}%</span><span>${formatShares(holding.shares)}</span></div>
            <div class="progress"><span style="width:${Math.min(100, allocation)}%"></span></div>
          </div>
        </td>`;
      body.appendChild(row);
    });

  if (!positions.length) {
    showPortfolioWarning("No open Trading 212 positions were returned for this account.");
  }
}

function renderPulse() {
  const grid = document.querySelector("#pulse-grid");
  grid.innerHTML = "";

  if (!state.pulse.length) {
    grid.innerHTML = `<div class="empty-state pulse-empty">Market pulse is temporarily unavailable.</div>`;
    return;
  }

  state.pulse.forEach(item => {
    const quote = item.quote || {};
    const change = Number(quote.dp);
    const changeClass = change > 0 ? "positive" : change < 0 ? "negative" : "neutral";
    const card = document.createElement("article");
    card.className = "pulse-card";
    card.innerHTML = `
      <div class="pulse-topline"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.symbol)}</small></div>
      <strong>${Number(quote.c) > 0 ? numberPrice(quote.c) : "—"}</strong>
      <span class="${changeClass}">${Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}</span>
      <small>${escapeHtml(item.description || "")}</small>`;
    grid.appendChild(card);
  });
}

function renderEarnings() {
  const list = document.querySelector("#earnings-list");
  const status = document.querySelector("#earnings-status");
  const moreButton = document.querySelector("#earnings-more");
  list.innerHTML = "";

  const portfolioSet = new Set(portfolioSymbols().map(symbol => canonicalTicker(symbol)));
  const portfolioMap = new Map((state.portfolio?.holdings || []).map(item => [
    canonicalTicker(item.marketSymbol || item.symbol),
    item
  ]));

  const allWeek = [...state.earnings]
    .filter(item => item.date)
    .map(event => ({
      ...event,
      market: event.market === "UK" || String(event.symbol || "").toUpperCase().endsWith(".L")
        ? "UK"
        : "US"
    }))
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      marketSortOrder(a.market) - marketSortOrder(b.market) ||
      Number(b.marketCap || 0) - Number(a.marketCap || 0)
    );

  const filtered = allWeek.filter(event => {
    const symbol = String(event.symbol || "").toUpperCase();
    const key = canonicalTicker(symbol);
    const market = event.market === "UK" ? "UK" : "US";
    const searchText = [
      symbol,
      event.companyName || "",
      portfolioMap.get(key)?.name || "",
      market,
      market === "UK" ? "ftse 100 lse london" : "us usa"
    ].join(" ").toLowerCase();

    const dayMatch = state.earningsDay === "all" || event.date === state.earningsDay;
    const marketMatch = state.earningsMarket === "all" || market === state.earningsMarket;
    const searchMatch = !state.earningsSearch || searchText.includes(state.earningsSearch);
    return dayMatch && marketMatch && searchMatch;
  });

  const allCounts = earningsMarketCounts(allWeek);
  const filteredCounts = earningsMarketCounts(filtered);
  const meta = state.earningsWeekMeta;
  const weekLabel = meta?.weekStart && meta?.weekEnd
    ? `${formatShortDate(meta.weekStart)}–${formatShortDate(meta.weekEnd)}`
    : "current week";
  const sourceLabel = meta?.source || "fallback data";
  const coverage = meta?.truncated ? " · result limit reached" : "";
  status.textContent =
    `${filtered.length} matching reports · ${filteredCounts.US} US · ${filteredCounts.UK} UK ` +
    `(${allCounts.US + allCounts.UK} total this week) · ${weekLabel} · ${sourceLabel}${coverage}`;

  if (!filtered.length) {
    list.innerHTML =
      `<div class="empty-state">No companies match this market, day or search. ` +
      `Choose All markets, clear the search or select another day.</div>`;
    moreButton?.classList.add("hidden");
  } else {
    filtered.slice(0, state.earningsVisibleLimit).forEach(event => {
      const symbol = String(event.symbol || "").toUpperCase();
      const key = canonicalTicker(symbol);
      const market = event.market === "UK" ? "UK" : "US";
      const date = new Date(`${event.date}T12:00:00`);
      const isPortfolio = portfolioSet.has(key);
      const actualText = event.epsActual === null || event.epsActual === undefined
        ? "—"
        : numberMetric(event.epsActual);
      const estimateText = event.epsEstimate === null || event.epsEstimate === undefined
        ? "—"
        : numberMetric(event.epsEstimate);
      const surprise = Number(event.epsSurprisePct);
      const surpriseText = Number.isFinite(surprise)
        ? `${surprise > 0 ? "+" : ""}${surprise.toFixed(1)}%`
        : "—";
      const surpriseClass = surprise > 0 ? "positive" : surprise < 0 ? "negative" : "neutral";
      const secondaryLabel = isPortfolio
        ? "MY HOLDING"
        : market === "UK"
          ? "FTSE 100"
          : marketCapLabel(event.marketCap);

      const item = document.createElement("a");
      item.className = "event earnings-event-link";
      item.href = event.sourceUrl ||
        `${market === "UK" ? "https://uk.finance.yahoo.com" : "https://finance.yahoo.com"}/quote/${encodeURIComponent(symbol)}`;
      item.target = "_blank";
      item.rel = "noopener noreferrer";
      item.innerHTML = `
        <div class="event-date">${date.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short"
        }).replace(" ", "<br>")}</div>
        <div>
          <div class="earnings-symbol-row">
            <div class="earnings-ticker-market">
              <strong>${escapeHtml(symbol)}</strong>
              <span class="earnings-market-badge ${market.toLowerCase()}">${market}</span>
            </div>
            <span class="earnings-sector">${escapeHtml(secondaryLabel)}</span>
          </div>
          <small>${escapeHtml(event.companyName || symbol)}</small>
          <div class="earnings-results-row">
            <span>Est. ${estimateText}</span>
            <span>Reported ${actualText}</span>
            <span class="${surpriseClass}">Surprise ${surpriseText}</span>
          </div>
        </div>
        <span class="timing">${timingLabel(event.hour)}</span>`;
      list.appendChild(item);
    });

    if (moreButton) {
      const remaining = filtered.length - state.earningsVisibleLimit;
      moreButton.classList.toggle("hidden", remaining <= 0);
      moreButton.textContent = remaining > 0
        ? `Show ${Math.min(100, remaining)} more (${remaining} remaining)`
        : "Show more";
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const future = allWeek.filter(event => event.date >= today);
  const nextDate = future[0]?.date;
  const nextCandidates = future.filter(event => event.date === nextDate);
  const next = nextCandidates.sort((a, b) =>
    Number(b.marketCap || 0) - Number(a.marketCap || 0)
  )[0];

  if (next) {
    const market = next.market === "UK" ? "UK" : "US";
    document.querySelector("#next-earnings").textContent = next.symbol;
    document.querySelector("#next-earnings-date").textContent =
      `${market} · ${new Date(`${next.date}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short"
      })}`;
  } else {
    document.querySelector("#next-earnings").textContent = "—";
    document.querySelector("#next-earnings-date").textContent = "No reports left this week";
  }
}

function earningsMarketCounts(events) {
  return events.reduce((counts, event) => {
    const market = event.market === "UK" ? "UK" : "US";
    counts[market] += 1;
    return counts;
  }, { US: 0, UK: 0 });
}

function marketSortOrder(market) {
  return market === "UK" ? 1 : 0;
}

function populateEarningsDayOptions() {
  const select = document.querySelector("#earnings-day");
  if (!select) return;
  const counts = new Map();
  state.earnings.forEach(event => {
    if (event.date) counts.set(event.date, (counts.get(event.date) || 0) + 1);
  });
  const current = state.earningsDay;
  select.innerHTML = `<option value="all">All week (${state.earnings.length})</option>`;
  [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([date, count]) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = `${new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} (${count})`;
    select.appendChild(option);
  });
  select.value = [...select.options].some(option => option.value === current) ? current : "all";
  state.earningsDay = select.value;
}

function marketCapLabel(value) {
  const cap = Number(value);
  if (!Number.isFinite(cap) || cap <= 0) return "US MARKET";
  if (cap >= 200_000_000_000) return "MEGA-CAP";
  if (cap >= 10_000_000_000) return "LARGE-CAP";
  if (cap >= 2_000_000_000) return "MID-CAP";
  if (cap >= 300_000_000) return "SMALL-CAP";
  return "MICRO-CAP";
}

function formatShortDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function canonicalTicker(symbol) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function renderNews() {
  const list = document.querySelector("#news-list");
  list.innerHTML = "";

  const filtered = state.news.filter(article => {
    const categoryMatch = state.newsCategory === "all" || article.category === state.newsCategory;
    const tickerText = normaliseNewsTickers(article).map(item => item.symbol).join(" ");
    const searchText = [
      article.headline || "",
      article.summary || "",
      article.source || "",
      tickerText
    ].join(" ").toLowerCase();
    const searchMatch = !state.newsSearch || searchText.includes(state.newsSearch);
    return categoryMatch && searchMatch;
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state news-empty">No headlines match this filter.</div>`;
    return;
  }

  filtered.slice(0, 15).forEach((article, index) => {
    const tickers = normaliseNewsTickers(article);
    const tickerHtml = tickers.length
      ? `<span class="news-ticker-list">${tickers.map(item =>
          `<span class="news-ticker-chip ${item.market.toLowerCase()}">${escapeHtml(item.symbol)}</span>`
        ).join("")}</span>`
      : `<span class="news-no-ticker">Market-wide</span>`;

    const card = document.createElement("a");
    card.className = `news-card${index === 0 ? " news-card-featured" : ""}`;
    card.href = article.url || "#";
    card.target = article.url && article.url !== "#" ? "_blank" : "_self";
    card.rel = "noopener noreferrer";
    card.innerHTML = `
      <div class="news-meta-row">
        <span class="news-category">${escapeHtml(categoryLabel(article.category))}</span>
        <span>${escapeHtml(article.source || "NEWS")}</span>
      </div>
      <h3>${escapeHtml(article.headline || "Untitled article")}</h3>
      ${article.summary
        ? `<p>${escapeHtml(truncate(article.summary, index === 0 ? 220 : 130))}</p>`
        : ""}
      <div class="news-footer">
        <time>${relativeTime(article.datetime)}</time>
        ${tickerHtml}
      </div>`;
    list.appendChild(card);
  });
}

function normaliseNewsTickers(article) {
  const raw = Array.isArray(article.tickers)
    ? article.tickers
    : article.relatedSymbol
      ? [article.relatedSymbol]
      : [];
  const map = new Map();

  raw.forEach(item => {
    const symbol = String(typeof item === "string" ? item : item?.symbol || "")
      .trim()
      .toUpperCase();
    if (!symbol) return;
    map.set(symbol, {
      symbol,
      market: (typeof item === "object" && item?.market)
        ? item.market
        : symbol.endsWith(".L")
          ? "UK"
          : "US"
    });
  });

  return [...map.values()].slice(0, 6);
}

function renderRadar() {
  const feed = document.querySelector("#trump-feed");
  feed.innerHTML = "";
  const marketOnly = document.querySelector("#trump-market-only").checked;
  const posts = state.radarPosts.filter(post => !marketOnly || post.marketSensitive);
  renderRadarStockSummary(posts);

  if (!posts.length) {
    const message = state.radarPosts.length
      ? "No recent items matched the market keywords. Turn off the filter to see everything returned."
      : "The free public sources could not be loaded. Open @DJTRadar for the latest tracking.";
    feed.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  posts.slice(0, 10).forEach(post => {
    const article = document.createElement("article");
    article.className = "trump-post";
    const topics = (post.topics || []).slice(0, 5);
    const mentions = (post.stockMentions || []).slice(0, 6);
    const source = post.source || (state.radarFallback ? "News coverage" : "Truth Social");
    const primaryLabel = mentions.length ? "Stock mention" : post.marketSensitive ? "Market-related" : "General";
    const primaryClass = mentions.length || post.marketSensitive ? "risk-badge" : "plain-badge";
    article.innerHTML = `
      <div class="trump-post-head">
        <span class="${primaryClass}">${primaryLabel}</span>
        <time>${relativeTime(post.datetime)}</time>
      </div>
      <p>${escapeHtml(truncate(post.text || post.headline || "", 560))}</p>
      ${mentions.length ? `<div class="stock-mention-row">${mentions.map(stockMentionMarkup).join("")}</div>` : ""}
      ${topics.length ? `<div class="topic-row">${topics.map(topic => `<span>${escapeHtml(topic)}</span>`).join("")}</div>` : ""}
      <div class="trump-post-footer">
        <span>${escapeHtml(source)}</span>
        <a href="${escapeHtml(post.url || "https://x.com/DJTRadar")}" target="_blank" rel="noopener noreferrer">View source</a>
      </div>`;
    feed.appendChild(article);
  });
}

function renderRadarStockSummary(posts) {
  const summary = document.querySelector("#trump-stock-summary");
  if (!summary) return;
  const mentions = [];
  const seen = new Set();

  [...posts]
    .sort((a, b) => Number(b.datetime || 0) - Number(a.datetime || 0))
    .forEach(post => {
      (post.stockMentions || []).forEach(mention => {
        const key = mention.symbol || mention.name;
        if (!key || seen.has(key)) return;
        seen.add(key);
        mentions.push(mention);
      });
    });

  if (!mentions.length) {
    summary.classList.add("hidden");
    summary.innerHTML = "";
    return;
  }

  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div><strong>Recent named stocks</strong><small>Live move is today; “since detected” starts when this browser first sees the newest mention.</small></div>
    <div class="trump-stock-strip">${mentions.slice(0, 8).map(stockMentionMarkup).join("")}</div>`;
}

function stockMentionMarkup(mention) {
  const symbol = mention.symbol || "PRIVATE";
  if (!mention.listed || !mention.symbol) {
    return `<span class="stock-reaction-chip private"><strong>${escapeHtml(mention.name || symbol)}</strong><small>Private / no quote</small></span>`;
  }

  const quote = state.radarQuotes[mention.symbol] || {};
  const dayMove = Number(quote.dp);
  const current = Number(quote.c);
  const baseline = state.radarBaselines[mention.symbol];
  const sinceDetected = baseline && Number.isFinite(current) && Number(baseline.price) > 0
    ? ((current / Number(baseline.price)) - 1) * 100
    : null;
  const dayClass = Number.isFinite(dayMove) ? (dayMove > 0 ? "positive" : dayMove < 0 ? "negative" : "neutral") : "neutral";
  const details = [];
  if (Number.isFinite(dayMove)) details.push(`${dayMove >= 0 ? "+" : ""}${dayMove.toFixed(2)}% today`);
  if (Number.isFinite(sinceDetected) && Math.abs(sinceDetected) >= 0.01) {
    details.push(`${sinceDetected >= 0 ? "+" : ""}${sinceDetected.toFixed(2)}% since detected`);
  }
  if (!details.length) details.push("Quote loading");

  return `<a class="stock-reaction-chip ${dayClass}" href="#stock-explorer" data-radar-symbol="${escapeHtml(mention.symbol)}" title="Open ${escapeHtml(mention.name || mention.symbol)} in Stock Explorer"><strong>${escapeHtml(mention.symbol)}</strong><small>${escapeHtml(details.join(" · "))}</small></a>`;
}

function renderInvestorSignals() {
  const list = document.querySelector("#signals-list");
  list.innerHTML = "";
  const filtered = state.investorSignals.filter(signal =>
    state.investorSignalType === "all" || signal.kind === state.investorSignalType
  );

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">No recent filings match this filter.</div>`;
    return;
  }

  filtered.slice(0, 18).forEach(signal => {
    const card = document.createElement("a");
    card.className = "signal-card";
    card.href = signal.url || "https://www.sec.gov/search-filings";
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.innerHTML = `
      <span class="signal-form">${escapeHtml(signal.form || "SEC")}</span>
      <span>
        <strong>${escapeHtml(signal.title || signal.entity || "SEC filing")}</strong>
        <small>${escapeHtml(signal.description || signal.kindLabel || "")} · ${relativeTime(signal.datetime)}</small>
      </span>`;
    list.appendChild(card);
  });
}

async function loadInvestor(id) {
  setInvestorLoading();
  try {
    const response = await fetch(`/.netlify/functions/investors?id=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error("SEC data unavailable");
    state.investor = await response.json();
  } catch {
    state.investor = { ...sampleInvestor, manager: document.querySelector("#investor-select").selectedOptions[0]?.textContent || sampleInvestor.manager };
  }
  renderInvestor();
}

function setInvestorLoading() {
  document.querySelector("#investor-report-date").textContent = "Loading…";
  document.querySelector("#investor-total-value").textContent = "—";
  document.querySelector("#investor-position-count").textContent = "—";
  document.querySelector("#investor-filed-date").textContent = "—";
  document.querySelector("#investor-holdings").innerHTML = "";
  document.querySelector("#investor-changes").innerHTML = "";
  document.querySelector("#manager-disclosures").innerHTML = "";
}

function renderInvestor() {
  const investor = state.investor || sampleInvestor;
  document.querySelector("#investor-report-date").textContent = investor.reportDate || "—";
  document.querySelector("#investor-total-value").textContent = investor.totalValue ? compactMoney(investor.totalValue) : "—";
  document.querySelector("#investor-position-count").textContent = investor.positionCount ?? "—";
  document.querySelector("#investor-filed-date").textContent = investor.filedDate || "—";

  const holdingsList = document.querySelector("#investor-holdings");
  holdingsList.innerHTML = "";
  (investor.holdings || []).slice(0, 7).forEach((holding, index) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <span class="rank-number">${index + 1}</span>
      <span><strong>${escapeHtml(holding.issuer)}</strong><small>${escapeHtml(holding.classTitle || holding.cusip || "")}</small></span>
      <span class="rank-value">${holding.value ? compactMoney(holding.value) : "—"}<small>${holding.shares ? compactNumber(holding.shares) + " sh" : ""}</small></span>`;
    holdingsList.appendChild(row);
  });

  const changesList = document.querySelector("#investor-changes");
  changesList.innerHTML = "";
  (investor.changes || []).slice(0, 7).forEach((change, index) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <span class="rank-number">${index + 1}</span>
      <span><strong>${escapeHtml(change.issuer)}</strong><small>${escapeHtml(change.classTitle || "")}</small></span>
      <span class="rank-value"><span class="move-badge ${escapeHtml(change.status || "")}">${escapeHtml(change.status || "changed")}</span><small>${formatSigned(change.shareChange, " shares")}</small></span>`;
    changesList.appendChild(row);
  });

  const disclosureList = document.querySelector("#manager-disclosures");
  disclosureList.innerHTML = "";
  const disclosures = investor.recentDisclosures || [];
  if (!disclosures.length) {
    disclosureList.innerHTML = `<span class="fine-print">No faster 13D, 13G or Form 4 filing was found under this manager entity’s CIK.</span>`;
  } else {
    disclosures.slice(0, 10).forEach(filing => {
      const link = document.createElement("a");
      link.className = "manager-filing";
      link.href = filing.url || "#";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.innerHTML = `<span>${escapeHtml(filing.form)}</span><small>${escapeHtml(filing.filingDate || "")}</small>`;
      disclosureList.appendChild(link);
    });
  }
}

function setDataStatus(finnhubLive) {
  const connected = state.portfolioSource === "trading212";
  const status = document.querySelector("#data-status");
  const detail = document.querySelector("#last-refresh");
  const dot = document.querySelector(".status-dot");

  if (connected && finnhubLive) {
    status.textContent = "Trading 212 connected";
    detail.textContent = "Holdings and market intelligence are live.";
    dot.style.background = "var(--positive)";
  } else if (connected) {
    status.textContent = "Trading 212 connected";
    detail.textContent = "Holdings are live; some market extras are unavailable.";
    dot.style.background = "var(--warning)";
  } else if (finnhubLive) {
    status.textContent = "Live market data";
    detail.textContent = "Market data is live; portfolio is using the local file.";
    dot.style.background = "var(--warning)";
  } else {
    status.textContent = "Local portfolio mode";
    detail.textContent = "Check API credentials if live data was expected.";
    dot.style.background = "var(--warning)";
  }
}

function showPortfolioWarning(message) {
  if (!message) return;
  const warning = document.querySelector("#portfolio-error");
  warning.textContent = message;
  warning.classList.remove("hidden");
}

function hidePortfolioWarning() {
  const warning = document.querySelector("#portfolio-error");
  warning.textContent = "";
  warning.classList.add("hidden");
}

function markRefresh(prefix = "Updated") {
  const label = `${prefix} ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  document.querySelector("#footer-refresh").textContent = label;
}

function highlightNavigation() {
  const links = [...document.querySelectorAll(".nav a")];
  links.forEach(link => link.addEventListener("click", () => {
    links.forEach(item => item.classList.remove("active"));
    link.classList.add("active");
  }));
}

function earningsCategoryLabel(category) {
  const labels = {
    portfolio: "My portfolio",
    technology: "Technology",
    communication: "Communication",
    "consumer-discretionary": "Consumer discretionary",
    "consumer-staples": "Consumer staples",
    financials: "Financials",
    "health-care": "Health care",
    industrials: "Industrials",
    energy: "Energy",
    utilities: "Utilities",
    "real-estate": "Real estate",
    materials: "Materials",
    custom: "Global extra"
  };
  return labels[category] || "Other";
}

function categoryLabel(category) {
  const labels = {
    global: "Global markets",
    ftse100: "FTSE 100",
    memory: "Memory & chips",
    megacaps: "Mega-caps",
    macro: "Macro & policy",
    portfolio: "My holdings"
  };
  return labels[category] || "Top story";
}

function money(value, currency = "GBP") {
  if (!Number.isFinite(Number(value))) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
    }).format(value);
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

function signedMoney(value, currency = "GBP") {
  if (!Number.isFinite(Number(value))) return "—";
  const absolute = money(Math.abs(Number(value)), currency);
  return `${Number(value) >= 0 ? "+" : "−"}${absolute}`;
}

function numberPrice(value) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(Number(value));
}

function numberMetric(value) {
  if (value === null || value === undefined || value === "" || value === "-") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: Math.abs(number) < 10 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(number);
}

function compactMoney(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1
  }).format(value);
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatShares(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 }).format(number)} shares`;
}

function formatSigned(value, suffix = "") {
  if (!Number.isFinite(Number(value))) return "";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${compactNumber(number)}${suffix}`;
}

function timingLabel(hour) {
  const labels = { amc: "After close", bmo: "Before open", dmh: "During market" };
  return labels[String(hour || "").toLowerCase()] || "Time TBC";
}

function relativeTime(timestamp) {
  if (!timestamp) return "";
  const milliseconds = Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000;
  const minutes = Math.max(1, Math.round((Date.now() - milliseconds) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(milliseconds).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function truncate(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function nextDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
