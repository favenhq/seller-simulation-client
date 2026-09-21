export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const FAVEN_DEVNET_BASE_URL = "https://devnet-api.faven.markets";
export const FAVEN_LOCALHOST_BASE_URL = "http://localhost:8787";
export const CONTRACT_QTY_SCALE = 1_000_000_000_000_000_000n;
export const STRIKE_SCALE = 100_000_000n;
export const BACKPACK_TICKER_URL = "https://api.backpack.exchange/api/v1/ticker";

const OPTIONS_PROGRAM_ID = "FAVENgBXzD9K9qYHKRF5RFRJeT4Qa2EV4EoTycki5gGT";

export interface MarketConfig {
  readonly marketAddress: string;
  readonly optionsProgramId: string;
  readonly baseCoinMint: string;
  readonly baseTokenProgram: string;
  readonly quoteCoinMint: string;
  readonly quoteTokenProgram: string;
  /** Amounts use the protocol's fixed 1e18 BaseCoin scale. */
  readonly allowedQuantities: readonly bigint[];
  /** Annualized implied volatility, expressed as a decimal (for example, 0.65 is 65%). */
  readonly impliedVolatility: number;
}

export type SolanaNetwork = "devnet" | "localhost";

const allowedQuantities = [
  10n * CONTRACT_QTY_SCALE,
  15n * CONTRACT_QTY_SCALE,
  20n * CONTRACT_QTY_SCALE,
  25n * CONTRACT_QTY_SCALE,
  40n * CONTRACT_QTY_SCALE,
  50n * CONTRACT_QTY_SCALE,
  80n * CONTRACT_QTY_SCALE,
  100n * CONTRACT_QTY_SCALE,
] as const;

const LOCALHOST_MARKETS: readonly MarketConfig[] = [
  {
    marketAddress: "99rh3FNKgvuWigwrsaDLMSD9cX8XWkFAdTdHqLkW3BCC",
    optionsProgramId: OPTIONS_PROGRAM_ID,
    baseCoinMint: "So11111111111111111111111111111111111111112",
    baseTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    quoteCoinMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    quoteTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    allowedQuantities,
    impliedVolatility: 0.65,
  },
  {
    marketAddress: "GJiEFYsYKdX39hkhSs9WLF8AfGgXRjEtegGj3UrHbpXW",
    optionsProgramId: OPTIONS_PROGRAM_ID,
    baseCoinMint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    baseTokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    quoteCoinMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    quoteTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    allowedQuantities,
    impliedVolatility: 1.3,
  },
  {
    marketAddress: "6gL1TzV6e4QSffGJdvM7hCoVfe1nTZiB68QPD9ye6NDW",
    optionsProgramId: OPTIONS_PROGRAM_ID,
    baseCoinMint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
    baseTokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    quoteCoinMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    quoteTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    allowedQuantities,
    impliedVolatility: 0.48,
  },
];

const DEVNET_MARKETS: readonly MarketConfig[] = [
  {
    marketAddress: "CY7qdovcTnpA6qo3Mp1J9Zws2ZnSnM7uXLyEXWGY3EUo",
    optionsProgramId: OPTIONS_PROGRAM_ID,
    baseCoinMint: "wSoLCzXHe214cjx7CFjP1axzXyqLkEwq5Xf873hy1JP",
    baseTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    quoteCoinMint: "usdcHvyN6fvECJ1poPYkt1vztze1pQ6psC8i4cji2Ly",
    quoteTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    allowedQuantities,
    impliedVolatility: 0.65,
  },
];

export interface NetworkConfig {
  readonly rfqBaseUrl: string;
  readonly markets: readonly MarketConfig[];
}

const networkConfigs: Readonly<Record<SolanaNetwork, NetworkConfig>> = {
  devnet: { rfqBaseUrl: FAVEN_DEVNET_BASE_URL, markets: DEVNET_MARKETS },
  localhost: {
    rfqBaseUrl: FAVEN_LOCALHOST_BASE_URL,
    markets: LOCALHOST_MARKETS,
  },
};

export function networkConfig(network: SolanaNetwork): NetworkConfig {
  return networkConfigs[network];
}

export function marketConfigurationReason(market: MarketConfig): string | undefined {
  if (market.allowedQuantities.length === 0) return "market_has_no_allowed_quantities";
  for (const quantity of market.allowedQuantities) {
    if (quantity <= 0n) return "invalid_market_quantity";
  }
  if (!Number.isFinite(market.impliedVolatility) || market.impliedVolatility <= 0) {
    return "invalid_implied_volatility";
  }
  return undefined;
}
