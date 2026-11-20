import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliUsageError, parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("defaults to read-only", () => {
    assert.deepEqual(parseCliArgs([], {}), { help: false, version: false, allowWrites: false });
  });

  it("enables writes with --allow-writes", () => {
    assert.equal(parseCliArgs(["--allow-writes"], {}).allowWrites, true);
  });

  it("enables writes with MP_ALLOW_WRITES=true", () => {
    assert.equal(parseCliArgs([], { MP_ALLOW_WRITES: "true" }).allowWrites, true);
    assert.equal(parseCliArgs([], { MP_ALLOW_WRITES: " TRUE " }).allowWrites, true);
  });

  it("keeps writes off for falsy MP_ALLOW_WRITES values", () => {
    for (const value of ["false", "0", "", "no"]) {
      assert.equal(parseCliArgs([], { MP_ALLOW_WRITES: value }).allowWrites, false);
    }
  });

  it("parses help and version flags", () => {
    assert.equal(parseCliArgs(["-h"], {}).help, true);
    assert.equal(parseCliArgs(["--version"], {}).version, true);
  });

  it("rejects unknown arguments", () => {
    assert.throws(() => parseCliArgs(["--allow-write"], {}), CliUsageError);
  });
});
