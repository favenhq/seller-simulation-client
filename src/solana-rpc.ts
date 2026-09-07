import { DEVNET_GENESIS_HASH } from "./config.js";

interface RpcSuccess {
  readonly result: unknown;
  readonly error?: undefined;
}

interface RpcFailure {
  readonly result?: undefined;
  readonly error: { readonly code: number; readonly message: string };
}

type RpcResponse = RpcSuccess | RpcFailure;

export class SolanaRpc {
  private requestId = 0;

  public constructor(private readonly url: string) {}

  public async isDevnet(): Promise<boolean> {
    return (await this.call("getGenesisHash", [])) === DEVNET_GENESIS_HASH;
  }

  public async tokenAccountsByOwner(
    owner: string,
    mint: string
  ): Promise<readonly TokenAccount[]> {
    const result = asRecord(
      await this.call("getTokenAccountsByOwner", [
        owner,
        { mint },
        { encoding: "jsonParsed" },
      ])
    );
    if (!Array.isArray(result.value)) throw new Error("invalid_token_accounts_response");
    const accounts: TokenAccount[] = [];
    for (const entry of result.value) {
      const account = asRecord(entry);
      const pubkey = stringValue(account.pubkey, "token_account_pubkey");
      const data = asRecord(asRecord(account.account).data);
      const parsed = asRecord(data.parsed);
      const info = asRecord(parsed.info);
      const tokenAmount = asRecord(info.tokenAmount);
      const amount = stringValue(tokenAmount.amount, "token_amount");
      if (!/^\d+$/.test(amount)) throw new Error("invalid_token_amount");
      accounts.push({ address: pubkey, amount: BigInt(amount) });
    }
    return accounts;
  }

  public async mintDecimals(mint: string): Promise<number> {
    const result = asRecord(await this.call("getTokenSupply", [mint]));
    const value = asRecord(result.value);
    const decimals = value.decimals;
    if (!Number.isInteger(decimals) || typeof decimals !== "number" || decimals < 0 || decimals > 18) {
      throw new Error("invalid_mint_decimals");
    }
    return decimals;
  }

  private async call(method: string, params: readonly unknown[]): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.requestId,
          method,
          params,
        }),
      });
    } catch {
      throw new Error("solana_rpc_network_error");
    }
    if (!response.ok) throw new Error(`solana_rpc_http_${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("solana_rpc_invalid_json");
    }
    const rpc = asRpcResponse(body);
    if (rpc.error) throw new Error(`solana_rpc_${rpc.error.code}`);
    return rpc.result;
  }
}

export interface TokenAccount {
  readonly address: string;
  readonly amount: bigint;
}

function asRpcResponse(value: unknown): RpcResponse {
  const record = asRecord(value);
  if ("error" in record) {
    const error = asRecord(record.error);
    const code = error.code;
    const message = error.message;
    if (typeof code !== "number" || typeof message !== "string") {
      throw new Error("solana_rpc_invalid_error");
    }
    return { error: { code, message } };
  }
  if (!("result" in record)) throw new Error("solana_rpc_missing_result");
  return { result: record.result };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("solana_rpc_invalid_response");
  }
  return Object.fromEntries(Object.entries(value));
}

function stringValue(value: unknown, reason: string): string {
  if (typeof value !== "string") throw new Error(reason);
  return value;
}
