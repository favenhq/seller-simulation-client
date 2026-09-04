import { Flags, Command } from "@oclif/core";

import {
  MARKETS,
  PROTOCOL_STRIKE_SCALE_CONFIRMED,
  marketConfigurationReason,
  type MarketConfig,
} from "../config.js";
import { log, safeReason } from "../log.js";
import { createRfq, submitUnderwrite, takerWebSocketUrl, waitForQuote, type RfqTerms } from "../rfq.js";
import { SolanaRpc } from "../solana-rpc.js";
import {
  choose,
  chooseStrike,
  expiryCandidates,
  fetchSpot,
  isFreshSpot,
  requiredCollateral,
} from "../terms.js";
import { uuidv7 } from "../uuidv7.js";
import { JsonRpcWebSocket } from "../websocket.js";
import { loadWallets, type SellerWallet } from "../wallets.js";

export default class Run extends Command {
  public static readonly description = "Run scheduled RFQ seller simulations";

  public static readonly flags = {
    rfqBaseUrl: Flags.string({ required: true, description: "RFQ server base URL" }),
    intervalSeconds: Flags.integer({
      default: 300,
      min: 1,
      description: "Seconds between scheduled cycles",
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Run);
    if (MARKETS.length === 0) {
      log("cycle_skipped", { reason: "no_configured_markets", outcome: "disabled" });
      return;
    }
    const invalidMarket = MARKETS.find((market) => marketConfigurationReason(market) !== undefined);
    if (invalidMarket) {
      log("cycle_skipped", {
        market: invalidMarket.marketAddress,
        reason: marketConfigurationReason(invalidMarket) ?? "invalid_market_configuration",
        outcome: "disabled",
      });
      return;
    }
    if (!PROTOCOL_STRIKE_SCALE_CONFIRMED) {
      log("cycle_skipped", { reason: "protocol_strike_scale_unreconciled", outcome: "disabled" });
      return;
    }

    let takerUrl: URL;
    try {
      takerUrl = takerWebSocketUrl(flags.rfqBaseUrl);
    } catch (error) {
      log("rpc_error", { reason: safeReason(error) });
      return;
    }
    const rpc = new SolanaRpc();
    try {
      if (!(await rpc.isDevnet())) {
        log("rpc_error", { reason: "solana_rpc_not_devnet" });
        return;
      }
    } catch (error) {
      log("rpc_error", { reason: safeReason(error) });
      return;
    }

    let wallets: readonly SellerWallet[];
    try {
      wallets = await loadWallets();
    } catch (error) {
      log("cycle_skipped", { reason: "setup_required", outcome: "disabled" });
      return;
    }

    const intervalMilliseconds = flags.intervalSeconds * 1_000;
    let nextCycleAt = Date.now();
    while (true) {
      await runCycle(rpc, takerUrl, wallets);
      nextCycleAt += intervalMilliseconds;
      if (nextCycleAt <= Date.now()) nextCycleAt = Date.now() + intervalMilliseconds;
      await wait(nextCycleAt - Date.now());
    }
  }
}

async function runCycle(
  rpc: SolanaRpc,
  takerUrl: URL,
  wallets: readonly SellerWallet[]
): Promise<void> {
  const rfqId = uuidv7();
  const market = choose(MARKETS);
  const seller = choose(wallets);
  const isPut = Math.random() < 0.5;
  const quantity = choose(market.allowedQuantities);
  logCycle("cycle_started", rfqId, market, seller, isPut, quantity);

  let spot;
  try {
    spot = await fetchSpot(market);
  } catch (error) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "invalid_or_missing_spot");
    return;
  }
  if (!isFreshSpot(spot, Math.floor(Date.now() / 1_000))) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "stale_spot");
    return;
  }
  const expiries = expiryCandidates(
    new Date(),
    Math.max(8 * 60 * 60 + 5 * 60, market.constraints.minimumExpiryLeadSeconds)
  );
  if (expiries.length === 0) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "no_eligible_expiry");
    return;
  }
  const expiry = choose(expiries);

  let strike: bigint;
  try {
    strike = chooseStrike(spot, isPut);
  } catch (error) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, safeReason(error));
    return;
  }
  const collateral = await collateralSource(rpc, market, seller, isPut, quantity, strike);
  if (collateral.error) {
    logCycle("rpc_error", rfqId, market, seller, isPut, quantity, collateral.error, expiry, strike);
    return;
  }
  if (!collateral.source) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "insufficient_collateral", expiry, strike);
    return;
  }

  const terms: RfqTerms = {
    rfqId,
    market,
    expiry,
    isPut,
    quantity,
    strike,
    seller: seller.publicKey,
    sellerCollateralSource: collateral.source,
  };
  let socket: JsonRpcWebSocket | undefined;
  try {
    socket = await JsonRpcWebSocket.connect(takerUrl);
    const requestDeadline = await createRfq(socket, terms);
    logCycle("rfq_created", rfqId, market, seller, isPut, quantity, undefined, expiry, strike);
    const quote = await waitForQuote(socket, rfqId, requestDeadline);
    if (!quote.underwriteTx) {
      logCycle("no_quote", rfqId, market, seller, isPut, quantity, quote.noQuoteReason ?? "no_valid_quote", expiry, strike);
      return;
    }
    await submitUnderwrite(socket, terms, quote.underwriteTx, seller.privateKey);
    logCycle("underwrite_queued", rfqId, market, seller, isPut, quantity, undefined, expiry, strike);
  } catch (error) {
    if (safeReason(error) === "websocket_timeout") {
      logCycle("no_quote", rfqId, market, seller, isPut, quantity, "request_deadline_elapsed", expiry, strike);
    } else {
      logCycle("rpc_error", rfqId, market, seller, isPut, quantity, safeReason(error), expiry, strike);
    }
  } finally {
    socket?.close();
  }
}

async function collateralSource(
  rpc: SolanaRpc,
  market: MarketConfig,
  seller: SellerWallet,
  isPut: boolean,
  quantity: bigint,
  strike: bigint
): Promise<{ readonly source?: string; readonly error?: string }> {
  try {
    const mint = isPut ? market.quoteCoinMint : market.baseCoinMint;
    const required = isPut
      ? requiredCollateral(
          quantity,
          strike,
          true,
          await rpc.mintDecimals(market.quoteCoinMint),
          await rpc.mintDecimals(market.baseCoinMint)
        )
      : requiredCollateral(quantity, strike, false, 0, 0);
    const account = (await rpc.tokenAccountsByOwner(seller.publicKey, mint)).find(
      (candidate) => candidate.amount >= required
    );
    return { source: account?.address };
  } catch (error) {
    return { error: safeReason(error) };
  }
}

function logCycle(
  event: string,
  rfqId: string,
  market: MarketConfig,
  seller: SellerWallet,
  isPut: boolean,
  quantity: bigint,
  reason?: string,
  expiry?: number,
  strike?: bigint
): void {
  log(event, {
    rfqId,
    market: market.marketAddress,
    seller: seller.publicKey,
    optionType: isPut ? "put" : "call",
    quantity: quantity.toString(),
    expiry: expiry ?? null,
    strike: strike?.toString() ?? null,
    outcome: event,
    reason: reason ?? null,
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}
