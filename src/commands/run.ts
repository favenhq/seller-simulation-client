import { Flags, Command } from "@oclif/core";

import {
  FAVEN_SANDBOX_BASE_URL,
  MARKETS,
  marketConfigurationReason,
  type MarketConfig,
} from "../config.js";
import { deriveAssociatedTokenAddress } from "../associated-token-address.js";
import { log, safeReason } from "../log.js";
import { createRfq, submitUnderwrite, takerWebSocketUrl, waitForQuote, type RfqTerms } from "../rfq.js";
import { SolanaRpc } from "../solana-rpc.js";
import {
  choose,
  chooseStrike,
  expiryCandidates,
  fetchSpot,
  isFreshSpot,
  requiredCollateralTokenBaseUnits,
} from "../terms.js";
import { uuidv7 } from "../uuidv7.js";
import { JsonRpcWebSocket } from "../websocket.js";
import { loadWallets, type SellerWallet } from "../wallets.js";

export default class Run extends Command {
  public static readonly description = "Run scheduled RFQ seller simulations";

  public static readonly flags = {
    rpcUrl: Flags.string({ required: true, description: "Solana devnet RPC URL" }),
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

    let takerUrl: URL;
    try {
      takerUrl = takerWebSocketUrl(FAVEN_SANDBOX_BASE_URL);
    } catch (error) {
      log("rpc_error", { reason: safeReason(error) });
      return;
    }
    const rpc = new SolanaRpc(flags.rpcUrl);
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
    let socket: JsonRpcWebSocket | undefined;
    while (true) {
      socket = await runCycle(rpc, takerUrl, wallets, socket);
      nextCycleAt += intervalMilliseconds;
      if (nextCycleAt <= Date.now()) nextCycleAt = Date.now() + intervalMilliseconds;
      await wait(nextCycleAt - Date.now());
    }
  }
}

async function runCycle(
  rpc: SolanaRpc,
  takerUrl: URL,
  wallets: readonly SellerWallet[],
  socket: JsonRpcWebSocket | undefined
): Promise<JsonRpcWebSocket | undefined> {
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
    const errMsg = error instanceof Error ? error.message : "";
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "invalid_or_missing_spot:" + errMsg);
    return socket;
  }
  if (!isFreshSpot(spot, Math.floor(Date.now() / 1_000))) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "stale_spot");
    return socket;
  }
  const expiries = expiryCandidates();
  if (expiries.length === 0) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "no_eligible_expiry");
    return socket;
  }
  const expiry = choose(expiries);

  let strike: bigint;
  try {
    strike = chooseStrike(spot, isPut, expiry, market);
  } catch (error) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, safeReason(error));
    return socket;
  }
  const accounts = await sellerSettlementAccounts(rpc, market, seller, isPut, quantity, strike);
  if (accounts.error) {
    logCycle("rpc_error", rfqId, market, seller, isPut, quantity, accounts.error, expiry, strike);
    return socket;
  }
  if (!accounts.collateralSource) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "insufficient_collateral", expiry, strike);
    return socket;
  }
  if (!isPut && !accounts.quoteDestination) {
    logCycle("cycle_skipped", rfqId, market, seller, isPut, quantity, "missing_quote_destination", expiry, strike);
    return socket;
  }

  const terms: RfqTerms = {
    rfqId,
    market,
    expiry,
    isPut,
    quantity,
    strike,
    seller: seller.publicKey,
    sellerCollateralSource: accounts.collateralSource,
    sellerQuoteDestination: accounts.quoteDestination,
  };
  try {
    socket ??= await JsonRpcWebSocket.connect(takerUrl);
    await createRfq(socket, terms);
    logCycle("rfq_created", rfqId, market, seller, isPut, quantity, undefined, expiry, strike);
    const quote = await waitForQuote(socket, rfqId);
    if (!quote.underwriteTx) {
      logCycle("no_quote", rfqId, market, seller, isPut, quantity, quote.noQuoteReason ?? "no_valid_quote", expiry, strike);
      return socket;
    }
    await submitUnderwrite(socket, terms, quote.underwriteTx, seller.privateKey);
    logCycle("underwrite_queued", rfqId, market, seller, isPut, quantity, undefined, expiry, strike);
    return socket;
  } catch (error) {
    const reason = safeReason(error);
    if (reason === "websocket_timeout") {
      logCycle("no_quote", rfqId, market, seller, isPut, quantity, "request_deadline_elapsed", expiry, strike);
    } else {
      logCycle("rpc_error", rfqId, market, seller, isPut, quantity, reason, expiry, strike);
    }
    return shouldReconnectSocket(reason) ? undefined : socket;
  }
}

function shouldReconnectSocket(reason: string): boolean {
  return reason !== "websocket_timeout" && reason.startsWith("websocket_");
}

async function sellerSettlementAccounts(
  rpc: SolanaRpc,
  market: MarketConfig,
  seller: SellerWallet,
  isPut: boolean,
  quantity: bigint,
  strikeE8: bigint
): Promise<{
  readonly collateralSource?: string;
  readonly quoteDestination?: string;
  readonly error?: string;
}> {
  try {
    const collateralMint = isPut ? market.quoteCoinMint : market.baseCoinMint;
    const quoteDestination = isPut
      ? undefined
      : deriveAssociatedTokenAddress(seller.publicKey, market.quoteCoinMint);
    const [baseCoinDecimals, quoteCoinDecimals, collateralAccounts, quoteAccounts] = await Promise.all([
      rpc.mintDecimals(market.baseCoinMint),
      isPut ? rpc.mintDecimals(market.quoteCoinMint) : Promise.resolve(0),
      rpc.tokenAccountsByOwner(seller.publicKey, collateralMint),
      isPut ? Promise.resolve(undefined) : rpc.tokenAccountsByOwner(seller.publicKey, market.quoteCoinMint),
    ]);
    const requiredCollateralBaseUnits = requiredCollateralTokenBaseUnits(
      quantity,
      strikeE8,
      isPut,
      baseCoinDecimals,
      quoteCoinDecimals
    );
    const collateralAccount = collateralAccounts.find(
      (candidate) => candidate.amount >= requiredCollateralBaseUnits
    );
    return {
      collateralSource: collateralAccount?.address,
      quoteDestination: quoteAccounts?.some((account) => account.address === quoteDestination)
        ? quoteDestination
        : undefined,
    };
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
