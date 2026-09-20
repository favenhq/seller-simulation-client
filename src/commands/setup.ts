import { Command, Flags } from "@oclif/core";

import { networkConfig } from "../config.js";
import { log, safeReason } from "../log.js";
import { SolanaRpc } from "../solana-rpc.js";
import { loadOrCreateWallets } from "../wallets.js";

export default class Setup extends Command {
  public static readonly description = "Create local seller wallets and fund them";

  public static readonly flags = {
    rpcUrl: Flags.string({ required: true, description: "Solana devnet or localhost RPC URL" }),
    rfqUrl: Flags.string({ description: "RFQ server URL; defaults for the selected network" }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Setup);
    log("setup_started");
    let walletResult;
    try {
      walletResult = await loadOrCreateWallets();
    } catch (error) {
      log("rpc_error", { reason: safeReason(error) });
      return;
    }
    for (const publicKey of walletResult.createdPublicKeys) {
      log("wallet_created", { seller: publicKey });
    }

    const rpc = new SolanaRpc(flags.rpcUrl);
    try {
      const network = await rpc.supportedNetwork();
      if (network === null) {
        log("rpc_error", { reason: "solana_rpc_unsupported_network" });
        return;
      }
      await fund(walletResult.wallets, flags.rfqUrl ?? networkConfig(network).rfqBaseUrl);
    } catch (error) {
      log("rpc_error", { reason: safeReason(error) });
      return;
    }
  }
}

async function fund(
  wallets: Awaited<ReturnType<typeof loadOrCreateWallets>>["wallets"],
  rfqBaseUrl: string
): Promise<void> {
  for (const wallet of wallets) {
    try {
      const funding = await fundWallet(wallet.publicKey, rfqBaseUrl);
      log("sol_wallet_funding_result", {
        seller: wallet.publicKey,
        outcome: "confirmed",
        transactionSignature: funding.signature,
        fundedAmounts: JSON.stringify(funding.funded),
      });
    } catch (error) {
      log("rpc_error", { seller: wallet.publicKey, reason: safeReason(error) });
    }
  }
}

interface WalletFundingResponse {
  readonly signature: string | null;
  readonly funded: Readonly<Record<string, string>>;
}

async function fundWallet(
  walletAddress: string,
  rfqBaseUrl: string
): Promise<WalletFundingResponse> {
  let response: Response;
  try {
    response = await fetch(new URL("/wallet-fundings", rfqBaseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });
  } catch (err) {
    console.error(err);
    throw new Error("wallet_funding_network_error");
  }
  if (response.status !== 201) {
    const errBody = await response.text();
    throw new Error(`wallet_funding_http_${response.status}:${errBody}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("wallet_funding_invalid_json");
  }
  const funding = parseFundedResponse(body);
  if (funding === null) throw new Error("wallet_funding_invalid_response");
  return funding;
}

function parseFundedResponse(value: unknown): WalletFundingResponse | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("signature" in value) ||
    !("funded" in value) ||
    (typeof value.signature !== "string" && value.signature !== null) ||
    typeof value.funded !== "object" ||
    value.funded === null ||
    Array.isArray(value.funded)
  ) {
    return null;
  }

  const funded: Record<string, string> = {};
  for (const [asset, amount] of Object.entries(value.funded)) {
    if (typeof amount !== "string") return null;
    funded[asset] = amount;
  }
  return { signature: value.signature, funded };
}
