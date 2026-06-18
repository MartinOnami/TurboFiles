import { describe, expect, it } from "vitest";
import { buildRequest, parseResponse, isWriteTool, providerById, validateToolArgs, PROVIDERS, type AgentMsg } from "@/lib/agent";

const convo: AgentMsg[] = [
  { role: "user", text: "list /var/www" },
  { role: "assistant", text: "", toolCalls: [{ id: "t1", name: "list_remote_directory", args: { path: "/var/www" } }] },
  { role: "tool", id: "t1", name: "list_remote_directory", content: "index.html" },
];

describe("agent provider adapters", () => {
  it("builds an Anthropic request with tool schemas", () => {
    const { url, body } = buildRequest("anthropic", "claude-3-5-sonnet-latest", "", convo);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const b = body as Record<string, unknown>;
    expect(b.model).toBe("claude-3-5-sonnet-latest");
    expect(Array.isArray(b.tools)).toBe(true);
    expect((b.tools as Array<{ input_schema: unknown }>)[0].input_schema).toBeDefined();
    // The tool result is folded into a following user turn.
    const msgs = b.messages as Array<{ role: string }>;
    expect(msgs[msgs.length - 1].role).toBe("user");
  });

  it("builds an OpenAI-compatible request with a base URL", () => {
    const { url, body } = buildRequest("openai", "gpt-4o", "http://localhost:11434/v1", convo);
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const b = body as Record<string, unknown>;
    expect((b.tools as Array<{ type: string }>)[0].type).toBe("function");
    expect((b.messages as Array<{ role: string }>)[0].role).toBe("system");
  });

  it("parses an Anthropic response (text + tool_use)", () => {
    const r = parseResponse("anthropic", {
      content: [
        { type: "text", text: "Sure." },
        { type: "tool_use", id: "x", name: "read_logs", input: { sinceMinutes: 30 } },
      ],
    });
    expect(r.text).toBe("Sure.");
    expect(r.toolCalls[0]).toEqual({ id: "x", name: "read_logs", args: { sinceMinutes: 30 } });
  });

  it("parses an OpenAI response (content + tool_calls)", () => {
    const r = parseResponse("openai", {
      choices: [
        {
          message: {
            content: "ok",
            tool_calls: [{ id: "y", function: { name: "delete_item", arguments: '{"scope":"local","path":"/tmp/x"}' } }],
          },
        },
      ],
    });
    expect(r.text).toBe("ok");
    expect(r.toolCalls[0]).toEqual({ id: "y", name: "delete_item", args: { scope: "local", path: "/tmp/x" } });
  });

  it("flags write tools (which require confirmation)", () => {
    expect(isWriteTool("delete_item")).toBe(true);
    expect(isWriteTool("rename_item")).toBe(true);
    expect(isWriteTool("add_site")).toBe(true);
    expect(isWriteTool("delete_site")).toBe(true);
    expect(isWriteTool("list_sites")).toBe(false);
    expect(isWriteTool("list_remote_directory")).toBe(false);
    expect(isWriteTool("read_logs")).toBe(false);
  });

  it("exposes each provider separately with its own format + base", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["anthropic", "openai", "deepseek", "moonshot", "ollama", "lmstudio"]),
    );
    expect(providerById("deepseek").kind).toBe("openai");
    expect(providerById("deepseek").baseUrl).toContain("deepseek");
    expect(providerById("ollama").local).toBe(true);
    expect(providerById("anthropic").kind).toBe("anthropic");
    // Unknown id falls back to the first provider rather than throwing.
    expect(providerById("nope").id).toBe(PROVIDERS[0].id);
  });

  it("validates tool arguments (rejects malformed/dangerous input)", () => {
    // Valid calls don't throw.
    expect(() => validateToolArgs("open_remote_directory", { path: "/wp-content" })).not.toThrow();
    expect(() => validateToolArgs("rename_item", { scope: "remote", from: "/a", to: "/b" })).not.toThrow();
    expect(() => validateToolArgs("add_site", { protocol: "sftp", host: "h", port: 22 })).not.toThrow();
    expect(() => validateToolArgs("delete_site", { name: "Blitz" })).not.toThrow();
    // Missing/empty/invalid args throw.
    expect(() => validateToolArgs("read_remote_file", { path: "" })).toThrow();
    expect(() => validateToolArgs("delete_site", { name: "" })).toThrow();
    expect(() => validateToolArgs("delete_item", { scope: "everything", path: "/x" })).toThrow();
    expect(() => validateToolArgs("add_site", { protocol: "telnet", host: "h" })).toThrow();
    expect(() => validateToolArgs("add_site", { protocol: "sftp", host: "h", port: 70000 })).toThrow();
    expect(() => validateToolArgs("download_items", { remotePaths: [] })).toThrow();
    // Control characters are rejected.
    expect(() => validateToolArgs("open_remote_directory", { path: "/a\u0001b" })).toThrow();
  });
});
