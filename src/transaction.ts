import { sign, type KeyObject } from "node:crypto";

import { encodeBase58 } from "./base58.js";

export function sellerSignExactTransaction(
  encodedTransaction: string,
  sellerPublicKey: string,
  sellerPrivateKey: KeyObject
): string {
  const transaction = Buffer.from(encodedTransaction, "base64");
  if (transaction.length === 0 || transaction.toString("base64") !== encodedTransaction) {
    throw new Error("invalid_underwrite_transaction_encoding");
  }
  const signatures = readShortVec(transaction, 0);
  const signatureStart = signatures.nextOffset;
  const messageOffset = signatureStart + signatures.value * 64;
  if (messageOffset >= transaction.length) throw new Error("invalid_underwrite_transaction");
  const accountKeys = signedAccountKeys(transaction, messageOffset);
  if (signatures.value < accountKeys.length || accountKeys.length === 0) {
    throw new Error("invalid_underwrite_transaction_signatures");
  }
  if (encodeBase58(accountKeys[0]!) !== sellerPublicKey) {
    throw new Error("seller_is_not_transaction_fee_payer");
  }
  const signature = sign(null, transaction.subarray(messageOffset), sellerPrivateKey);
  signature.copy(transaction, signatureStart);
  return transaction.toString("base64");
}

function signedAccountKeys(transaction: Buffer, messageOffset: number): readonly Buffer[] {
  let offset = messageOffset;
  if ((transaction[offset]! & 0x80) !== 0) {
    if ((transaction[offset]! & 0x7f) !== 0) throw new Error("unsupported_transaction_version");
    offset += 1;
  }
  if (offset + 3 > transaction.length) throw new Error("invalid_transaction_message");
  const signerCount = transaction[offset]!;
  offset += 3;
  const keyCount = readShortVec(transaction, offset);
  offset = keyCount.nextOffset;
  if (keyCount.value < signerCount || offset + keyCount.value * 32 > transaction.length) {
    throw new Error("invalid_transaction_accounts");
  }
  const keys: Buffer[] = [];
  for (let index = 0; index < signerCount; index += 1) {
    keys.push(transaction.subarray(offset + index * 32, offset + (index + 1) * 32));
  }
  return keys;
}

function readShortVec(bytes: Buffer, start: number): { readonly value: number; readonly nextOffset: number } {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.length && shift <= 28) {
    const byte = bytes[offset++]!;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, nextOffset: offset };
    shift += 7;
  }
  throw new Error("invalid_shortvec");
}
