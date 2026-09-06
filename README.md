# Faven seller simulator

Standalone Node/Oclif CLI that simulates option sellers against the RFQ server on Solana devnet. It does not import Faven application code.

```sh
pnpm build
pnpm sim:setup
pnpm sim:run --rfqBaseUrl https://sandbox-api.faven.markets
```

`setup` creates and reuses exactly three local wallets, requests devnet SOL, and reports that token funding has not been implemented. Wallet secrets are stored with owner-only file permissions at `.store/seller-wallets.json` in the repository and are never logged.

The sample market in [src/config.ts](src/config.ts) remains disabled until the deployed Options program is reconciled to the canonical `1e8` strike scale and `PROTOCOL_STRIKE_SCALE_CONFIRMED` is set to `true`. Each market must include its deployed addresses, mints, Hermes feed ID, and allowed fixed-`1e18` quantities.
