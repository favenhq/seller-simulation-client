import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { test } from "node:test";
import { encodeBase58 } from "../dist/base58.js";
import { sellerSignExactTransaction } from "../dist/transaction.js";

function wallet() {
  const pair = generateKeyPairSync("ed25519");
  return { ...pair, bytes: pair.publicKey.export({format: "der", type: "spki"}).subarray(-32) };
}

for (const sellerIndex of [0, 1, 2]) {
  test(`seller signs its own slot ${sellerIndex} and preserves the sponsor and buyer slots`, () => {
    const seller = wallet();
    const others = [wallet(), wallet()];
    const keys = [...others];
    keys.splice(sellerIndex, 0, seller);
    const message = Buffer.concat([
      Buffer.from([128, 3, 1, 0, 3]), ...keys.map((key) => key.bytes),
      Buffer.alloc(32), Buffer.from([0, 0]),
    ]);
    const signatures = keys.map((key, index) => index === sellerIndex ? Buffer.alloc(64) : sign(null, message, key.privateKey));
    const encoded = Buffer.concat([Buffer.from([3]), ...signatures, message]).toString("base64");
    const signed = Buffer.from(sellerSignExactTransaction(encoded, encodeBase58(seller.bytes), seller.privateKey), "base64");
    assert.deepEqual(signed.subarray(193), message);
    for (let index = 0; index < 3; index++) {
      const signature = signed.subarray(1 + index * 64, 1 + (index + 1) * 64);
      assert.ok(verify(null, message, keys[index].publicKey, signature));
      if (index !== sellerIndex) assert.deepEqual(signature, signatures[index]);
    }
  });
}

test("refuses to sign when the seller is absent from required signers", () => {
  const seller = wallet();
  const other = wallet();
  const message = Buffer.concat([Buffer.from([128, 1, 0, 0, 1]), other.bytes, Buffer.alloc(32), Buffer.from([0, 0])]);
  const encoded = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]).toString("base64");
  assert.throws(() => sellerSignExactTransaction(encoded, encodeBase58(seller.bytes), seller.privateKey), /seller_is_not_transaction_signer/);
});
