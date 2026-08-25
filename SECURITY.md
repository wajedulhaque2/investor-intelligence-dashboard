# Security notes

## Secrets

Never commit `.env`, API keys, API secrets, bearer tokens or a personal SEC contact string copied from a working environment.

If a secret is ever committed or shared, revoke/rotate it rather than relying on deleting the file later; Git history and external copies may still contain it.

## Trading 212 connector

`netlify/functions/trading212.mjs` is designed for a private/local dashboard. It returns portfolio/account information to its caller.

For a public demo deployment:

- leave Trading 212 credentials unset;
- use `data/portfolio.example.json` as the fallback; and
- do not expose a live account through an unauthenticated public function.

Add proper authentication/access control before enabling live account data on a hosted deployment.
