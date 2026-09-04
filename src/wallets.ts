import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { encodeBase58 } from "./base58.js";

const WALLET_DIRECTORY = join(homedir(), ".faven-seller-simulation");
const WALLET_FILE = join(WALLET_DIRECTORY, "seller-wallets.json");
const WALLET_COUNT = 3;

interface StoredWallet {
  readonly publicKey: string;
  readonly privateKeyPem: string;
}

interface StoredWalletFile {
  readonly version: 1;
  readonly wallets: readonly StoredWallet[];
}

export interface SellerWallet {
  readonly publicKey: string;
  readonly privateKey: KeyObject;
}

export interface WalletLoadResult {
  readonly wallets: readonly SellerWallet[];
  readonly createdPublicKeys: readonly string[];
}

export async function loadOrCreateWallets(): Promise<WalletLoadResult> {
  try {
    return { wallets: await loadWallets(), createdPublicKeys: [] };
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const wallets = Array.from({ length: WALLET_COUNT }, createWallet);
  await mkdir(WALLET_DIRECTORY, { recursive: true, mode: 0o700 });
  const stored: StoredWalletFile = {
    version: 1,
    wallets: wallets.map((wallet) => ({
      publicKey: wallet.publicKey,
      privateKeyPem: wallet.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    })),
  };
  await writeFile(WALLET_FILE, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
  return {
    wallets,
    createdPublicKeys: wallets.map((wallet) => wallet.publicKey),
  };
}

export async function loadWallets(): Promise<readonly SellerWallet[]> {
  const raw = await readFile(WALLET_FILE, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("wallet_file_invalid_json");
  }
  const file = parseWalletFile(parsed);
  if (file.wallets.length !== WALLET_COUNT) throw new Error("wallet_file_wrong_count");
  return file.wallets.map((wallet) => {
    const privateKey = createPrivateKey(wallet.privateKeyPem);
    const publicKey = addressFromPrivateKey(privateKey);
    if (publicKey !== wallet.publicKey) throw new Error("wallet_file_public_key_mismatch");
    return { publicKey, privateKey };
  });
}

function createWallet(): SellerWallet {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey: addressFromPrivateKey(privateKey) };
}

function addressFromPrivateKey(privateKey: KeyObject): string {
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKeyBytes = spki.subarray(-32);
  return encodeBase58(publicKeyBytes);
}

function parseWalletFile(value: unknown): StoredWalletFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("wallet_file_invalid_shape");
  }
  const record = Object.fromEntries(Object.entries(value));
  if (record.version !== 1 || !Array.isArray(record.wallets)) {
    throw new Error("wallet_file_invalid_shape");
  }
  const wallets = record.wallets.map((wallet) => {
    if (typeof wallet !== "object" || wallet === null || Array.isArray(wallet)) {
      throw new Error("wallet_file_invalid_wallet");
    }
    const entry = Object.fromEntries(Object.entries(wallet));
    if (typeof entry.publicKey !== "string" || typeof entry.privateKeyPem !== "string") {
      throw new Error("wallet_file_invalid_wallet");
    }
    return { publicKey: entry.publicKey, privateKeyPem: entry.privateKeyPem };
  });
  return { version: 1, wallets };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
