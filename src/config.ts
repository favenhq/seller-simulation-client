export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const BASE_COIN_SCALE = 1_000_000_000_000_000_000n;
export const STRIKE_SCALE = 100_000_000n;
export const PYTH_HERMES_URL = "https://hermes.pyth.network";

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
    marketAddress: "TBD",
    optionsProgramId: "TBD",
    baseCoinMint: "twSoL...",
    quoteCoinMint: "tUSDC...",
    pythFeedId: "ef0d8b6c38daef2981a8b13d2fbc1396a84d284347209ffef4442657d4253965",
    allowedQuantities: [
      1n * BASE_COIN_SCALE,
      5n * BASE_COIN_SCALE,
      10n * BASE_COIN_SCALE,
      15n * BASE_COIN_SCALE,
      20n * BASE_COIN_SCALE,
      25n * BASE_COIN_SCALE,
      40n * BASE_COIN_SCALE,
      50n * BASE_COIN_SCALE,
      80n * BASE_COIN_SCALE,
      100n * BASE_COIN_SCALE,
    ],
  }
];

/**
 * The checked source protocol currently has a 1e6 on-chain strike scale.
 * This guard must stay false until the deployed program is reconciled to 1e8.
 */
export const PROTOCOL_STRIKE_SCALE_CONFIRMED = false;

export function marketConfigurationReason(market: MarketConfig): string | undefined {
  if (market.allowedQuantities.length === 0) return "market_has_no_allowed_quantities";
  for (const quantity of market.allowedQuantities) {
    if (quantity <= 0n) return "invalid_market_quantity";
  }
  return undefined;
}
