# Changelog

## 5.5 — FTSE 100 expansion

- Added the complete FTSE 100 company universe.
- Added a dedicated FTSE 100 news category.
- Added S&P 500 + FTSE 100 ticker recognition in news.
- Merged US and FTSE 100 events into the weekly earnings calendar.
- Added US/UK market labels and an earnings market filter.

## 5.4 — Auto refresh

- Added Off / 30 seconds / 60 seconds auto-refresh controls.
- Refreshes only fast-changing panels automatically: portfolio/account data, quotes, market pulse and company-mention reactions.
- Keeps news, earnings, fundamentals and SEC filings on manual refresh to reduce unnecessary provider calls.
- Pauses auto refresh while the browser tab is hidden.

## 5.3 — Public-statement stock reaction tracking

- Detects explicit cashtags and named public companies in Trump-related posts/content.
- Adds ticker badges and current daily stock moves.
- Stores a local price baseline when the browser first detects a new mention.
- Supports listed and private-company labelling and links detected tickers into Stock Explorer.
- Keeps direct Truth Social, public RSS and news fallbacks without requiring the X API.

## 5.2.1 — Earnings renderer fix

- Fixed a missing `numberMetric()` helper call that could leave the earnings grid blank despite successful data loading.

## 5.2 — Rolling weekly earnings

- Replaced the fixed 90-day earnings list with a rolling Sunday-to-Saturday weekly calendar.
- Added estimated EPS, reported EPS and surprise percentage where available.
- Added day filtering, event counts and company search.
- Added Yahoo Finance calendar data with Finnhub fallback.
- Added pagination for larger weekly event sets.

## 5.1 — S&P 500 earnings universe

- Replaced the small manual company list with an S&P 500 universe plus portfolio symbols and selected global companies.
- Added sector filters and broader ticker/company search.
- Added a bundled S&P 500 fallback snapshot.

## 5.0 — Stock Explorer and account performance

- Added searchable stock fundamentals and contextual heuristics.
- Added market cap, average volume, P/E, dividend yield, 52-week position, beta, price-to-book and revenue growth.
- Added Trading 212 total account value and realised + unrealised P/L views.

## 4.1 — Public Trump Watch sources

- Removed the paid X API requirement.
- Added direct Truth Social, public RSS and recent-news fallbacks.
- Retained market-related keyword filtering and source labels.

## 4.0 — SEC signals and broader earnings coverage

- Expanded the earnings universe and filtering.
- Added Schedule 13D/13G and Form 4 SEC signals.
- Added recent disclosure links for selected managers.
