import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliUsageError, parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("defaults to read-only with writes and refunds disabled", () => {
    assert.deepEqual(parseCliArgs([], {}), {
      help: false,
      version: false,
      allowWrites: false,
      allowRefunds: false,
    });
  });

  it("enables writes with --allow-writes without enabling refunds", () => {
    const options = parseCliArgs(["--allow-writes"], {});
    assert.equal(options.allowWrites, true);
    assert.equal(options.allowRefunds, false);
  });

  it("enables refunds with --allow-refunds without enabling writes", () => {
    const options = parseCliArgs(["--allow-refunds"], {});
    assert.equal(options.allowRefunds, true);
    assert.equal(options.allowWrites, false);
  });

  it("enables both when both flags are passed", () => {
    const options = parseCliArgs(["--allow-writes", "--allow-refunds"], {});
    assert.equal(options.allowWrites, true);
    assert.equal(options.allowRefunds, true);
  });

  it("enables refunds with MP_ALLOW_REFUNDS=true", () => {
    const options = parseCliArgs([], { MP_ALLOW_REFUNDS: "true" });
    assert.equal(options.allowRefunds, true);
    assert.equal(options.allowWrites, false);
  });

  it("does not enable refunds from MP_ALLOW_WRITES", () => {
    assert.equal(parseCliArgs([], { MP_ALLOW_WRITES: "true" }).allowRefunds, false);
  });

  it("keeps refunds off for falsy MP_ALLOW_REFUNDS values", () => {
    for (const value of ["false", "0", "", "no"]) {
      assert.equal(parseCliArgs([], { MP_ALLOW_REFUNDS: value }).allowRefunds, false);
    }
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
    assert.throws(() => parseCliArgs(["--allow-refund"], {}), CliUsageError);
  });
});
