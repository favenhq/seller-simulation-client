export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
// export const FAVEN_SANDBOX_BASE_URL = "https://sandbox-api.faven.markets";
export const FAVEN_SANDBOX_BASE_URL = "http://localhost:8787";
export const CONTRACT_QTY_SCALE = 1_000_000_000_000_000_000n;
export const STRIKE_SCALE = 100_000_000n;
export const PYTH_HERMES_URL = "https://hermes.pyth.network";

const OPTIONS_PROGRAM_ID = "FAVENgBXzD9K9qYHKRF5RFRJeT4Qa2EV4EoTycki5gGT";

export interface MarketConfig {
  readonly marketAddress: string;
  readonly optionsProgramId: string;
  readonly baseCoinMint: string;
  readonly quoteCoinMint: string;
  readonly pythFeedId: string;
  /** Amounts use the protocol's fixed 1e18 BaseCoin scale. */
  readonly allowedQuantities: readonly bigint[];
}

/**
 * Populate only after the RFQ server and deployed Options program both use
 * STRIKE_SCALE (1e8). Keeping this empty prevents accidental live activity.
 */
export const MARKETS: readonly MarketConfig[] = [
  {
    marketAddress: "CY7qdovcTnpA6qo3Mp1J9Zws2ZnSnM7uXLyEXWGY3EUo",
    optionsProgramId: OPTIONS_PROGRAM_ID,
    baseCoinMint: "wSoLCzXHe214cjx7CFjP1axzXyqLkEwq5Xf873hy1JP",
    quoteCoinMint: "usdcHvyN6fvECJ1poPYkt1vztze1pQ6psC8i4cji2Ly",
    pythFeedId: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    allowedQuantities: [
      1n * CONTRACT_QTY_SCALE,
      5n * CONTRACT_QTY_SCALE,
      10n * CONTRACT_QTY_SCALE,
      15n * CONTRACT_QTY_SCALE,
      20n * CONTRACT_QTY_SCALE,
      25n * CONTRACT_QTY_SCALE,
      40n * CONTRACT_QTY_SCALE,
      50n * CONTRACT_QTY_SCALE,
      80n * CONTRACT_QTY_SCALE,
      100n * CONTRACT_QTY_SCALE,
    ],
  }
];

export function marketConfigurationReason(market: MarketConfig): string | undefined {
  if (market.allowedQuantities.length === 0) return "market_has_no_allowed_quantities";
  for (const quantity of market.allowedQuantities) {
    if (quantity <= 0n) return "invalid_market_quantity";
  }
  return undefined;
}
