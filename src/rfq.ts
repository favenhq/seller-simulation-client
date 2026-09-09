import type { KeyObject } from "node:crypto";

import type { MarketConfig } from "./config.js";
import { sellerSignExactTransaction } from "./transaction.js";
import { uuidv7 } from "./uuidv7.js";
import { JsonRpcWebSocket } from "./websocket.js";

export interface RfqTerms {
  readonly rfqId: string;
  readonly market: MarketConfig;
  readonly expiry: number;
  readonly isPut: boolean;
  readonly quantity: bigint;
  readonly strike: bigint;
  readonly seller: string;
  readonly sellerCollateralSource: string;
  /** QuoteCoin premium destination for calls. Puts reuse sellerCollateralSource. */
  readonly sellerQuoteDestination?: string;
}

export interface QuoteResult {
  readonly underwriteTx?: string;
  readonly noQuoteReason?: string;
}

const QUOTE_RESULT_TIMEOUT_MS = 10_000;

export async function createRfq(
  socket: JsonRpcWebSocket,
  terms: RfqTerms
): Promise<number> {
  const requestId = uuidv7();
  socket.send({
    jsonrpc: "2.0",
    id: requestId,
    method: "rfq.create",
    params: {
      rfqId: terms.rfqId,
      market: terms.market.marketAddress,
      expiry: terms.expiry,
      isPut: terms.isPut,
      quantity: terms.quantity.toString(),
      strike: terms.strike.toString(),
      seller: terms.seller,
      sellerCollateralSource: terms.sellerCollateralSource,
      ...(terms.sellerQuoteDestination === undefined
        ? {}
        : { sellerQuoteDestination: terms.sellerQuoteDestination }),
    },
  });
  const response = await socket.next(matchesId(requestId), 15_000);
  const result = successResult(response);
  const rfqId = stringField(result.rfqId, "invalid_rfq_create_response");
  const requestDeadline = numberField(result.requestDeadline, "invalid_rfq_create_response");
  if (rfqId !== terms.rfqId || requestDeadline <= Date.now()) {
    throw new Error("invalid_rfq_create_response");
  }
  return requestDeadline;
}

export async function waitForQuote(
  socket: JsonRpcWebSocket,
  rfqId: string
): Promise<QuoteResult> {
  const notification = await socket.next(
    (message) => message.method === "quote.best" && notificationRfqId(message) === rfqId,
    QUOTE_RESULT_TIMEOUT_MS
  );
  const params = recordField(notification.params, "invalid_quote_notification");
  if (typeof params.noQuoteReason === "string") return { noQuoteReason: params.noQuoteReason };
  const quote = recordField(params.quote, "invalid_quote_notification");
  return { underwriteTx: stringField(quote.underwriteTx, "invalid_quote_transaction") };
}

export async function submitUnderwrite(
  socket: JsonRpcWebSocket,
  terms: RfqTerms,
  underwriteTx: string,
  sellerPrivateKey: KeyObject
): Promise<void> {
  const signedTransaction = sellerSignExactTransaction(
    underwriteTx,
    terms.seller,
    sellerPrivateKey
  );
  const requestId = uuidv7();
  socket.send({
    jsonrpc: "2.0",
    id: requestId,
    method: "underwrite.submit",
    params: { rfqId: terms.rfqId, underwriteTx: signedTransaction },
  });
  const response = await socket.next(matchesId(requestId), 15_000);
  const result = successResult(response);
  if (result.rfqId !== terms.rfqId || result.status !== "queued") {
    throw new Error("invalid_underwrite_submit_response");
  }
}

export function takerWebSocketUrl(rfqBaseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rfqBaseUrl);
  } catch {
    throw new Error("invalid_rfq_base_url");
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("invalid_rfq_base_url");
  url.search = "";
  url.hash = "";
  if (url.pathname.endsWith("/taker")) return url;
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return new URL("taker", url);
}

function matchesId(id: string): (message: Record<string, unknown>) => boolean {
  return (message) => message.id === id;
}

function notificationRfqId(message: Record<string, unknown>): string | undefined {
  if (!isRecord(message.params)) return undefined;
  return typeof message.params.rfqId === "string" ? message.params.rfqId : undefined;
}

function successResult(message: Record<string, unknown>): Record<string, unknown> {
  if ("error" in message) throw new Error("rfq_json_rpc_error");
  return recordField(message.result, "invalid_rfq_json_rpc_response");
}

function recordField(value: unknown, reason: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(reason);
  return Object.fromEntries(Object.entries(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, reason: string): string {
  if (typeof value !== "string") throw new Error(reason);
  return value;
}

function numberField(value: unknown, reason: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(reason);
  return value;
}
