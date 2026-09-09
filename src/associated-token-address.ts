import { createHash } from "node:crypto";

import { decodeBase58, encodeBase58 } from "./base58.js";

const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const ED25519_FIELD_MODULUS = (1n << 255n) - 19n;
const ED25519_D = mod(-121665n * modularInverse(121666n));
const ED25519_SQRT_MINUS_ONE = modularExponentiate(2n, (ED25519_FIELD_MODULUS - 1n) / 4n);

export function deriveAssociatedTokenAddress(owner: string, mint: string): string {
  return findProgramAddress(
    [decodeAddress(owner), decodeAddress(TOKEN_PROGRAM), decodeAddress(mint)],
    decodeAddress(ASSOCIATED_TOKEN_PROGRAM)
  );
}

function findProgramAddress(seeds: readonly Uint8Array[], programAddress: Uint8Array): string {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const address = createProgramAddress([...seeds, new Uint8Array([bump])], programAddress);
    if (address !== undefined) return encodeBase58(address);
  }
  throw new Error("unable_to_derive_program_address");
}

function createProgramAddress(
  seeds: readonly Uint8Array[],
  programAddress: Uint8Array
): Uint8Array | undefined {
  const hash = createHash("sha256");
  for (const seed of seeds) hash.update(seed);
  hash.update(programAddress);
  hash.update(PDA_MARKER);
  const address = new Uint8Array(hash.digest());
  return isEd25519Point(address) ? undefined : address;
}

function decodeAddress(value: string): Uint8Array {
  const address = decodeBase58(value);
  if (address.length !== 32) throw new Error("invalid_solana_address");
  return address;
}

function isEd25519Point(bytes: Uint8Array): boolean {
  const sign = (bytes[31]! & 0x80) !== 0;
  const y = littleEndianInteger(bytes) & ((1n << 255n) - 1n);
  if (y >= ED25519_FIELD_MODULUS) return false;
  const ySquared = mod(y * y);
  const xSquared = mod((ySquared - 1n) * modularInverse(mod(ED25519_D * ySquared + 1n)));
  let x = modularExponentiate(xSquared, (ED25519_FIELD_MODULUS + 3n) / 8n);
  if (mod(x * x) !== xSquared) x = mod(x * ED25519_SQRT_MINUS_ONE);
  return mod(x * x) === xSquared && !(x === 0n && sign);
}

function littleEndianInteger(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) + BigInt(bytes[index]!);
  }
  return value;
}

function modularInverse(value: bigint): bigint {
  return modularExponentiate(value, ED25519_FIELD_MODULUS - 2n);
}

function modularExponentiate(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = mod(result * factor);
    factor = mod(factor * factor);
    power >>= 1n;
  }
  return result;
}

function mod(value: bigint): bigint {
  const remainder = value % ED25519_FIELD_MODULUS;
  return remainder < 0n ? remainder + ED25519_FIELD_MODULUS : remainder;
}
