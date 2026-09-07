# Faven seller simulator

Standalone Node/Oclif CLI that simulates option sellers against the RFQ server on Solana devnet. It does not import Faven application code.

```sh
pnpm build
pnpm sim:setup --rpcUrl https://api.devnet.solana.com
PYTH_API_KEY=<api key for spot price> pnpm sim:run --rpcUrl https://api.devnet.solana.com
```

`setup` creates and reuses exactly three local wallets, then funds them through the RFQ server wallet-funding API. Wallet secrets are stored with owner-only file permissions at `.store/seller-wallets.json` in the repository and are never logged.

The sample market in [src/config.ts](src/config.ts) remains disabled until the deployed Options program is reconciled to the canonical `1e8` strike scale and `PROTOCOL_STRIKE_SCALE_CONFIRMED` is set to `true`. Each market must include its deployed addresses, mints, Hermes feed ID, and allowed fixed-`1e18` quantities.

## Possible Improvements

- Validate the transaction before signing. The client signs any base64 transaction whose first signer is the seller, without checking its instructions or that it matches the RFQ terms. A malicious/compromised WebSocket endpoint can obtain a valid signature for an arbitrary transfer and broadcast it directly, bypassing the server’s later validation. Decode and validate the complete transaction locally against the market, seller, collateral account, expiry, strike, quantity, and expected program instructions before signing.

- Reserve collateral until execution resolves. The balance check only reflects current on-chain funds. After an underwrite is queued, its collateral is not reserved locally, so a later cycle can sign another transaction using the same funds before the first transaction lands. One transaction will then fail on-chain. Track pending collateral per seller and mint, releasing it only after confirmed success or failure. Alternative solution is to block seller from underwriting until his previous transaction is unresolved.
