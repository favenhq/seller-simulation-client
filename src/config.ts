export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const BASE_COIN_SCALE = 1_000_000_000_000_000_000n;
export const STRIKE_SCALE = 100_000_000n;

export interface MarketConstraints {
  readonly minimumExpiryLeadSeconds: number;
  readonly quantityMinimum: bigint;
  readonly quantityMaximum: bigint;
  readonly quantityStep: bigint;
}

export interface MarketConfig {
  readonly marketAddress: string;
  readonly optionsProgramId: string;
  readonly baseCoinMint: string;
  readonly quoteCoinMint: string;
  readonly pythFeedId: string;
  readonly hermesUrl: string;
  /** Amounts use the protocol's fixed 1e18 BaseCoin scale. */
  readonly allowedQuantities: readonly bigint[];
  /** Mirror every server rule that is needed for RFQ acceptance. */
  readonly constraints: MarketConstraints;
}

/**
 * Populate only after the RFQ server and deployed Options program both use
 * STRIKE_SCALE (1e8). Keeping this empty prevents accidental live activity.
 */
export const MARKETS: readonly MarketConfig[] = [];

/**
 * The checked source protocol currently has a 1e6 on-chain strike scale.
 * This guard must stay false until the deployed program is reconciled to 1e8.
 */
export const PROTOCOL_STRIKE_SCALE_CONFIRMED = false;

export function marketConfigurationReason(market: MarketConfig): string | undefined {
  if (market.allowedQuantities.length === 0) return "market_has_no_allowed_quantities";
  if (
    market.constraints.minimumExpiryLeadSeconds < 0 ||
    market.constraints.quantityStep <= 0n ||
    market.constraints.quantityMinimum <= 0n ||
    market.constraints.quantityMaximum < market.constraints.quantityMinimum
  ) {
    return "invalid_market_constraints";
  }
  for (const quantity of market.allowedQuantities) {
    if (
      quantity < market.constraints.quantityMinimum ||
      quantity > market.constraints.quantityMaximum ||
      (quantity - market.constraints.quantityMinimum) % market.constraints.quantityStep !== 0n
    ) {
      return "market_quantity_constraint_mismatch";
    }
  }
  return undefined;
}
