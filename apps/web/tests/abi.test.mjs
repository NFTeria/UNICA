import assert from "node:assert/strict";
import { test } from "node:test";
import { abiEncode, encodeCall } from "../assets/abi.js";

test("sized integers and bytes encode as one word each, and a value that does not fit is refused", () => {
  assert.equal(abiEncode(["uint128"], [1987612n]), (1987612n).toString(16).padStart(64, "0"));
  assert.equal(abiEncode(["uint64"], [1700000000n]), BigInt(1700000000).toString(16).padStart(64, "0"));
  assert.equal(abiEncode(["int8"], [-1n]), "f".repeat(64));
  assert.equal(abiEncode(["int256"], [-2n]), "f".repeat(63) + "e");
  assert.equal(abiEncode(["bytes4"], ["0xdeadbeef"]), "deadbeef" + "0".repeat(56));
  assert.throws(() => abiEncode(["uint128"], [1n << 128n]), /does not fit uint128/);
  assert.throws(() => abiEncode(["int8"], [128n]), /does not fit int8/);
  assert.throws(() => abiEncode(["bytes4"], ["0xdeadbe"]), /exactly 4 bytes/);
  assert.throws(() => abiEncode(["uint7"], [1n]), /unsupported static type/);
});

test("the register's order call encodes with two uint128 amounts and a uint64 deadline", () => {
  const data = encodeCall("createOrder(address,address,uint128,uint128,uint64,bytes32)", [
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "0x90F79bf6EB2c4f870365E785982E1f101E93b906", 2500000n, 2400000n, 1789084813n, "0x" + "ab".repeat(32),
  ]);
  assert.equal(data.length, 2 + 8 + 6 * 64);
  assert.match(data, /^0x[0-9a-f]+$/);
});
