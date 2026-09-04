import { Command } from "@oclif/core";

import { MARKETS } from "../config.js";
import { log, safeReason } from "../log.js";
import { SolanaRpc } from "../solana-rpc.js";
import { UnavailableTokenFunder } from "../token-funder.js";
import { loadOrCreateWallets } from "../wallets.js";

const AIRDROP_LAMPORTS = 2_000_000_000n;

export default class Setup extends Command {
  public static readonly description = "Create local seller wallets and request devnet funding";

  public async run(): Promise<void> {
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

    for (const wallet of walletResult.wallets) {
      try {
        const signature = await rpc.requestAirdrop(wallet.publicKey, AIRDROP_LAMPORTS);
        log("sol_airdrop_result", {
          seller: wallet.publicKey,
          outcome: "requested",
          transactionSignature: signature,
        });
      } catch (error) {
        log("rpc_error", { seller: wallet.publicKey, reason: safeReason(error) });
      }
    }
    await new UnavailableTokenFunder().fund(walletResult.wallets, MARKETS);
  }
}
