import type { MarketConfig } from "./config.js";

import { log } from "./log.js";
import type { SellerWallet } from "./wallets.js";

export interface TokenFunder {
  fund(wallets: readonly SellerWallet[], markets: readonly MarketConfig[]): Promise<void>;
}

/** Token faucets own the amounts; no token funding adapter is available yet. */
export class UnavailableTokenFunder implements TokenFunder {
  public async fund(
    wallets: readonly SellerWallet[],
    markets: readonly MarketConfig[]
  ): Promise<void> {
    if (markets.length > 0) {
      for (const market of markets) {
        for (const wallet of wallets) {
          log("token_funder_unavailable", {
            reason: "token_funding_not_implemented",
            seller: wallet.publicKey,
            market: market.marketAddress,
          });
        }
      }
      return;
    }
    log("token_funder_unavailable", {
      reason: "token_funding_not_implemented",
      sellerWalletCount: wallets.length,
      configuredMarketCount: markets.length,
    });
  }
}
