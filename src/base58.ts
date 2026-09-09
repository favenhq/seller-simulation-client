const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_INDEX = new Map([...ALPHABET].map((character, index) => [character, index]));

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  if (leadingZeroes === bytes.length) return "1".repeat(leadingZeroes);
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] * 256;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let encoded = "";
  encoded = "1".repeat(leadingZeroes);
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    encoded += ALPHABET[digits[index]];
  }
  return encoded;
}

export function decodeBase58(value: string): Uint8Array {
  if (value.length === 0) return new Uint8Array();
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") leadingZeroes += 1;
  if (leadingZeroes === value.length) return new Uint8Array(leadingZeroes);
  const bytes = [0];
  for (let inputIndex = leadingZeroes; inputIndex < value.length; inputIndex += 1) {
    const character = value[inputIndex]!;
    const digit = ALPHABET_INDEX.get(character);
    if (digit === undefined) throw new Error("invalid_base58");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return new Uint8Array([
    ...new Array<number>(leadingZeroes).fill(0),
    ...bytes.reverse(),
  ]);
}
