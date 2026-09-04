# Faven seller simulator

Standalone Node/Oclif CLI that simulates option sellers against the RFQ server on Solana devnet. It does not import Faven application code.

```sh
corepack pnpm build
corepack pnpm start setup
corepack pnpm start run --rfqBaseUrl https://your-rfq-server.example
```

`setup` creates and reuses exactly three local wallets, requests devnet SOL, and reports that token funding has not been implemented. Wallet secrets are stored with owner-only file permissions under `~/.faven-seller-simulation` and are never logged.

Markets are deliberately empty in [src/config.ts](src/config.ts). Before adding one, reconcile the deployed Options program to the canonical `1e8` strike scale and set `PROTOCOL_STRIKE_SCALE_CONFIRMED` to `true`. Each market must include its deployed addresses, mints, Hermes feed, allowed fixed-`1e18` quantities, and RFQ-server constraints.
