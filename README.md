# Faven seller simulator

Standalone Node/Oclif CLI that simulates option sellers against the RFQ server on Solana devnet or localhost.

```sh
pnpm seller:setup --rpcUrl "https://api.devnet.solana.com"
pnpm seller:run --rpcUrl "https://api.devnet.solana.com"
```

For local development, run the local Solana validator and RFQ server, then use:

```sh
pnpm seller:setup --rpcUrl "http://localhost:8899"
pnpm seller:run --rpcUrl "http://localhost:8899"
```

The localhost RFQ server defaults to `http://localhost:8787`. Pass `--rfqUrl` when it uses another address.

`setup` creates and reuses exactly three local wallets, then funds them through the RFQ server wallet-funding API. Wallet secrets are stored with owner-only file permissions at `.store/seller-wallets.json` in the repository and are never logged.

The RFQ server sponsor pays the network fee and account rent when opening a trade. The seller signs its own required signer slot, preserving the buyer and sponsor slots.

Run `corepack pnpm test` to build and check transaction signature preservation.

## Possible Improvements

- Validate the transaction before signing. The client signs any base64 transaction that requires the seller signature, without checking its instructions or that it matches the RFQ terms. A malicious/compromised WebSocket endpoint can obtain a valid signature for an arbitrary transfer and broadcast it directly, bypassing the server’s later validation. Decode and validate the complete transaction locally against the market, seller, collateral account, expiry, strike, quantity, and expected program instructions before signing.

- Reserve collateral until execution resolves. The balance check only reflects current on-chain funds. After an underwrite is queued, its collateral is not reserved locally, so a later cycle can sign another transaction using the same funds before the first transaction lands. One transaction will then fail on-chain. Track pending collateral per seller and mint, releasing it only after confirmed success or failure. Alternative solution is to block seller from underwriting until his previous transaction is unresolved.
