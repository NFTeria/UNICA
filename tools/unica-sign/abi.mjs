// A minimal ABI codec — only the shapes UNICA V2's `settle` actually uses.
//
// WHY NOT A LIBRARY. This tool exists to be a SECOND implementation. Reaching for the same
// encoder the rest of the ecosystem uses would make it a second caller of one implementation,
// which cannot disagree with itself and therefore cannot catch anything. Written from the ABI
// specification, and checked against the selector Solidity computes for the same signature.
//
// It handles exactly: static words (uint, int, bool, address, bytes32), static tuples, and
// dynamic `bytes`. It refuses anything else rather than guessing — a codec that silently mishandles
// a type it was never taught produces calldata that decodes to something else.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";

const WORD = 32;

export function bytesFromHex(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) throw new Error(`not hex: ${hex}`);
  const body = hex.slice(2);
  if (body.length % 2) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function wordUint(value) {
  let v = BigInt(value);
  if (v < 0n) throw new Error("wordUint is unsigned");
  if (v >= 1n << 256n) throw new Error("value does not fit in 32 bytes");
  const out = new Uint8Array(WORD);
  for (let i = WORD - 1; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/// Two's complement, so a negative tick encodes the way the EVM reads it.
export function wordInt(value) {
  let v = BigInt(value);
  if (v >= 1n << 255n || v < -(1n << 255n)) throw new Error("value does not fit in a signed word");
  if (v < 0n) v += 1n << 256n;
  return wordUint(v);
}

export function wordAddress(addr) {
  const b = bytesFromHex(addr);
  if (b.length !== 20) throw new Error(`not a 20-byte address: ${addr}`);
  const out = new Uint8Array(WORD);
  out.set(b, 12);
  return out;
}

export function wordBytes32(value) {
  const b = bytesFromHex(value);
  if (b.length !== WORD) throw new Error(`not 32 bytes: ${value}`);
  return b;
}

export function wordBool(value) {
  if (typeof value !== "boolean") throw new Error("wordBool wants a boolean");
  return wordUint(value ? 1 : 0);
}

/// A dynamic `bytes`: its length, then its content, right-padded to a whole number of words.
export function encodeBytes(hex) {
  const b = bytesFromHex(hex);
  const padded = new Uint8Array(Math.ceil(b.length / WORD) * WORD);
  padded.set(b, 0);
  return concat(wordUint(b.length), padded);
}

export function decodeBytes(data, at) {
  const len = Number(readUint(data, at));
  const start = at + WORD;
  if (start + len > data.length) throw new Error("dynamic bytes runs past the end of the payload");
  return toHex(data.slice(start, start + len));
}

export function readUint(data, at) {
  if (at + WORD > data.length) throw new Error("word read runs past the end of the payload");
  let v = 0n;
  for (let i = 0; i < WORD; i++) v = (v << 8n) | BigInt(data[at + i]);
  return v;
}

export function readAddress(data, at) {
  const v = readUint(data, at);
  if (v >= 1n << 160n) throw new Error("an address word has dirty upper bits");
  return toHex(data.slice(at + 12, at + WORD));
}

export function readBytes32(data, at) {
  if (at + WORD > data.length) throw new Error("word read runs past the end of the payload");
  return toHex(data.slice(at, at + WORD));
}

export function readBool(data, at) {
  const v = readUint(data, at);
  if (v > 1n) throw new Error("a bool word is neither 0 nor 1");
  return v === 1n;
}

/// Signed, from two's complement.
export function readInt(data, at) {
  const v = readUint(data, at);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

export const selectorOf = (signature) => toHex(keccak256(new TextEncoder().encode(signature))).slice(0, 10);
