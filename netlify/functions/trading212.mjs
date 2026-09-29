const ALLOWED_ENVIRONMENTS = new Set(["live", "demo"]);

export default async () => {
  const apiKey = process.env.TRADING212_API_KEY;
  const apiSecret = process.env.TRADING212_API_SECRET;
  const requestedEnvironment = String(process.env.TRADING212_ENVIRONMENT || "live").toLowerCase();
  const environment = ALLOWED_ENVIRONMENTS.has(requestedEnvironment) ? requestedEnvironment : "live";

  if (!apiKey || !apiSecret) {
    return json({
      error: "Trading 212 credentials are not configured.",
      code: "TRADING212_NOT_CONFIGURED"
    }, 503);
  }

  const origin = environment === "demo"
    ? "https://demo.trading212.com"
    : "https://live.trading212.com";
  const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, "utf8").toString("base64")}`;
  const headers = {
    Authorization: authorization,
    Accept: "application/json"
  };

  try {
    const [positionsResponse, summaryResponse] = await Promise.all([
      fetch(`${origin}/api/v0/equity/positions`, { headers }),
      fetch(`${origin}/api/v0/equity/account/summary`, { headers })
    ]);

    if (!positionsResponse.ok) {
      return trading212Error(positionsResponse, "positions");
    }
    if (!summaryResponse.ok) {
      return trading212Error(summaryResponse, "account summary");
    }

    const positions = await positionsResponse.json();
    const summary = await summaryResponse.json();
    const accountCurrency = normaliseCurrency(summary.currency || "GBP");

    const holdings = (Array.isArray(positions) ? positions : [])
      .map(position => normalisePosition(position, accountCurrency))
      .filter(holding => holding.shares > 0)
      .sort((a, b) => finiteOrZero(b.value) - finiteOrZero(a.value));

    const currentValue = finiteOrNull(summary.investments?.currentValue);
    const totalCost = finiteOrNull(summary.investments?.totalCost);
    const unrealizedProfitLoss = finiteOrNull(summary.investments?.unrealizedProfitLoss);
    const realizedProfitLoss = finiteOrNull(summary.investments?.realizedProfitLoss);
    const cashAvailable = finiteOrNull(summary.cash?.availableToTrade);
    const cashInPies = finiteOrNull(summary.cash?.inPies);
    const cashReserved = finiteOrNull(summary.cash?.reservedForOrders);
    const totalAccountValue = firstFinite(
      summary.totalValue,
      finiteOrZero(currentValue) + finiteOrZero(cashAvailable) + finiteOrZero(cashInPies) + finiteOrZero(cashReserved)
    );

    return json({
      source: "trading212",
      environment,
      accountCurrency,
      summary: {
        currentValue,
        totalCost,
        unrealizedProfitLoss,
        realizedProfitLoss,
        allTimeProfitLoss: finiteOrZero(unrealizedProfitLoss) + finiteOrZero(realizedProfitLoss),
        totalAccountValue,
        cashAvailable,
        cashInPies,
        cashReserved
      },
      holdings,
      fetchedAt: new Date().toISOString()
    }, 200, 15);
  } catch (error) {
    console.error("Trading 212 connector failed:", error);
    return json({
      error: "The Trading 212 request could not be completed.",
      code: "TRADING212_REQUEST_FAILED"
    }, 502);
  }
};

function normalisePosition(position, accountCurrency) {
  const instrument = position.instrument || {};
  const brokerTicker = String(instrument.ticker || position.ticker || "Unknown");
  const rawCurrency = normaliseCurrency(instrument.currencyCode || instrument.currency || accountCurrency);
  const priceDivisor = rawCurrency === "GBX" ? 100 : 1;
  const displayCurrency = rawCurrency === "GBX" ? "GBP" : rawCurrency;
  const shares = finiteOrZero(position.quantity);
  const averageCost = finiteOrZero(position.averagePricePaid) / priceDivisor;
  const currentPrice = finiteOrZero(position.currentPrice) / priceDivisor;
  const walletImpact = position.walletImpact || {};

  const unrealizedProfitLoss = firstFinite(
    walletImpact.unrealizedProfitLoss,
    walletImpact.unrealizedPnl,
    walletImpact.profitLoss,
    walletImpact.result,
    position.unrealizedProfitLoss
  );

  let value = firstFinite(
    walletImpact.currentValue,
    walletImpact.marketValue,
    walletImpact.positionValue,
    walletImpact.value,
    walletImpact.totalValue,
    position.currentValue,
    position.value
  );

  let cost = firstFinite(
    walletImpact.totalCost,
    walletImpact.costBasis,
    walletImpact.investedValue,
    walletImpact.cost,
    position.totalCost
  );

  // These fallbacks are exact only when the instrument and account use the same currency.
  if (value === null && displayCurrency === accountCurrency) value = shares * currentPrice;
  if (cost === null && displayCurrency === accountCurrency) cost = shares * averageCost;
  if (cost === null && value !== null && unrealizedProfitLoss !== null) cost = value - unrealizedProfitLoss;

  const marketSymbol = inferMarketSymbol(brokerTicker, rawCurrency);
  const displaySymbol = marketSymbol || cleanBrokerTicker(brokerTicker);

  return {
    symbol: displaySymbol,
    marketSymbol,
    brokerTicker,
    name: String(instrument.name || instrument.shortName || displaySymbol),
    instrumentType: instrument.type || null,
    isin: instrument.isin || null,
    currency: displayCurrency,
    rawCurrency,
    shares,
    quantityAvailableForTrading: finiteOrNull(position.quantityAvailableForTrading),
    quantityInPies: finiteOrNull(position.quantityInPies),
    averageCost,
    currentPrice,
    value,
    cost,
    unrealizedProfitLoss,
    account: "Trading 212",
    openedAt: position.createdAt || null
  };
}

function inferMarketSymbol(brokerTicker, currency) {
  const ticker = String(brokerTicker || "").trim().toUpperCase();
  if (!ticker) return null;

  if (ticker.endsWith("_US_EQ")) return ticker.slice(0, -6);
  if (ticker.endsWith("_LSE_EQ")) return `${ticker.slice(0, -7)}.L`;
  if (ticker.endsWith("_GB_EQ")) return `${ticker.slice(0, -6)}.L`;

  if (ticker.endsWith("_EQ")) {
    const base = ticker.slice(0, -3);
    if (currency === "GBP" || currency === "GBX") return `${base}.L`;
    if (currency === "USD") return base;
    return base;
  }

  return ticker;
}

function cleanBrokerTicker(ticker) {
  return String(ticker || "").replace(/_(?:US|LSE|GB)?_?EQ$/i, "");
}

async function trading212Error(response, operation) {
  let providerMessage = "";
  try {
    const body = await response.json();
    providerMessage = String(body.message || body.error || "").slice(0, 240);
  } catch {
    providerMessage = "";
  }

  let message = `Trading 212 rejected the ${operation} request.`;
  if (response.status === 401) message = "Trading 212 rejected the API key or secret.";
  if (response.status === 403) message = "The Trading 212 key does not have permission to read this account.";
  if (response.status === 429) message = "Trading 212 rate-limited the dashboard. Wait briefly, then refresh.";

  return json({
    error: message,
    providerMessage: providerMessage || undefined,
    code: `TRADING212_${response.status}`
  }, response.status);
}

function normaliseCurrency(value) {
  return String(value || "GBP").trim().toUpperCase();
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge
        ? `private, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`
        : "no-store"
    }
  });
}
