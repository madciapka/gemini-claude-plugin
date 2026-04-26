import { strict as assert } from "node:assert";
import {
  parseGeminiJsonResult,
  consumeStreamLines
} from "../../scripts/lib/gemini.mjs";

export default function (t) {
  t.test("parseGeminiJsonResult skips deprecation prefix", () => {
    const stdout = `Warning: --allowed-tools is deprecated\n{"session_id":"abc","response":"hello","stats":{"models":{"gemini-3.1-pro-preview":{"api":{"totalLatencyMs":1234},"tokens":{"input":10,"candidates":2,"total":15,"cached":0,"thoughts":3}}}}}`;
    const parsed = parseGeminiJsonResult(stdout);
    assert.equal(parsed.sessionId, "abc");
    assert.equal(parsed.response, "hello");
    assert.equal(parsed.model, "gemini-3.1-pro-preview");
    assert.equal(parsed.usage.input, 10);
    assert.equal(parsed.usage.output, 2);
    assert.equal(parsed.usage.total, 15);
    assert.equal(parsed.usage.thoughts, 3);
    assert.equal(parsed.durationMs, 1234);
  });

  t.test("parseGeminiJsonResult returns null for non-JSON output", () => {
    assert.equal(parseGeminiJsonResult("not json at all"), null);
    assert.equal(parseGeminiJsonResult(""), null);
  });

  t.test("parseGeminiJsonResult handles missing stats gracefully", () => {
    const parsed = parseGeminiJsonResult(`{"session_id":"x","response":"r"}`);
    assert.equal(parsed.response, "r");
    assert.equal(parsed.usage, null);
    assert.equal(parsed.model, null);
  });

  t.test("parseGeminiJsonResult surfaces error field", () => {
    const parsed = parseGeminiJsonResult(`{"error":{"message":"boom"}}`);
    assert.equal(parsed.error.message, "boom");
  });

  t.test("consumeStreamLines parses NDJSON events and keeps remainder", () => {
    const buffer = `{"type":"init","session_id":"a"}\n{"type":"message","content":"hi"}\n{"type":"par`;
    const { events, remainder, noise } = consumeStreamLines(buffer);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "init");
    assert.equal(events[1].content, "hi");
    assert.equal(remainder, `{"type":"par`);
    assert.equal(noise.length, 0);
  });

  t.test("consumeStreamLines collects unparseable lines as noise", () => {
    const buffer = `not json\n{"type":"ok"}\n`;
    const { events, noise } = consumeStreamLines(buffer);
    assert.equal(events.length, 1);
    assert.deepEqual(noise, ["not json"]);
  });

  t.test("consumeStreamLines handles empty buffer", () => {
    const { events, remainder, noise } = consumeStreamLines("");
    assert.equal(events.length, 0);
    assert.equal(remainder, "");
    assert.equal(noise.length, 0);
  });
}
