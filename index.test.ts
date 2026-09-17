/** Plugin boundary tests for Composio MCP file materialization. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { createPluginRuntimeMock } from "openclaw/plugin-sdk/plugin-test-runtime";

const saveMediaSource = vi.hoisted(() => vi.fn());
const openSessionCache = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/media-store", () => ({ saveMediaSource }));
vi.mock("./src/session-cache.js", () => ({ openSessionCache }));

import plugin from "./index.js";

function registerFileResultMiddleware() {
  const registerAgentToolResultMiddleware = vi.fn();
  plugin.register(createTestPluginApi({ registerAgentToolResultMiddleware }));
  return registerAgentToolResultMiddleware.mock.calls[0]?.[0];
}

describe("composio plugin", () => {
  beforeEach(() => saveMediaSource.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("joins admitted resolutions before closing the cache and withholds stopped connections", async () => {
    let complete!: (response: Response) => void;
    let started!: () => void;
    const response = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        started();
        return response;
      }),
    );
    let closed = false;
    const cache = {
      lookup: async () => undefined,
      register: vi.fn(async () => {
        expect(closed).toBe(false);
      }),
      delete: async () => false,
      close: vi.fn(() => {
        closed = true;
      }),
    };
    openSessionCache.mockReturnValue(cache);
    const registerService = vi.fn();
    const registerMcpServerConnectionResolver = vi.fn();
    plugin.register(
      createTestPluginApi({
        config: { plugins: { entries: { composio: { config: { apiKey: "fixture" } } } } },
        runtime: createPluginRuntimeMock({ state: { resolveStateDir: () => "/fixture" } }),
        registerService,
        registerMcpServerConnectionResolver,
      }),
    );
    const service = registerService.mock.calls[0][0];
    const resolver = registerMcpServerConnectionResolver.mock.calls[0][0];
    const resolving = resolver.resolve({ requesterSenderId: "U1" });
    await requestStarted;
    const stopping = service.stop();
    expect(cache.close).not.toHaveBeenCalled();
    expect(await resolver.resolve({ requesterSenderId: "U2" })).toBeNull();
    complete(Response.json({ session_id: "trs-1", mcp: { url: "https://example.com/mcp" } }));
    expect(await resolving).toBeNull();
    await stopping;
    expect(cache.register).toHaveBeenCalledOnce();
    expect(cache.close).toHaveBeenCalledOnce();
    expect(await resolver.resolve({ requesterSenderId: "U1" })).toBeNull();
    expect(openSessionCache).toHaveBeenCalledOnce();
  });

  it("materializes signed Composio file results before they reach the transcript", async () => {
    const middleware = registerFileResultMiddleware();
    expect(middleware).toBeTypeOf("function");

    const signedUrl =
      "https://files.example.test/invoice.pdf?X-Amz-Signature=0123456789abcdef0123456789abcdef";
    const savedPath = "/var/lib/openclaw/media/outbound/invoice---id.pdf";
    saveMediaSource.mockResolvedValueOnce({
      id: "invoice---id.pdf",
      path: savedPath,
      size: 7,
      contentType: "application/pdf",
    });

    const output = await middleware(
      {
        toolCallId: "call-gmail-attachment",
        toolName: "composio__gmail_get_attachment",
        args: {},
        result: {
          content: [
            {
              type: "text",
              text: `structuredContent:\n${JSON.stringify(
                {
                  data: {
                    file: {
                      name: "invoice.pdf",
                      mimetype: "application/pdf",
                      s3url: signedUrl,
                    },
                  },
                  successful: true,
                },
                null,
                2,
              )}`,
            },
          ],
          details: {
            mcpServer: "composio",
            mcpTool: "GMAIL_GET_ATTACHMENT",
            structuredContent: {
              data: {
                file: {
                  name: "invoice.pdf",
                  mimetype: "application/pdf",
                  s3url: signedUrl,
                },
              },
              successful: true,
            },
          },
        },
      },
      { runtime: "openclaw" },
    );

    expect(saveMediaSource).toHaveBeenCalledWith(signedUrl, undefined, "outbound", 5 * 1024 * 1024);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain(signedUrl);
    expect(serialized).toContain(savedPath);
    expect(serialized).toContain(`MEDIA:${savedPath}`);
  });

  it("removes an unusable signed URL and gives the agent a recovery action", async () => {
    const middleware = registerFileResultMiddleware();
    const signedUrl =
      "https://files.example.test/invoice.pdf?X-Amz-Signature=abcdef0123456789abcdef0123456789";
    saveMediaSource.mockRejectedValueOnce(new Error("download failed"));

    const output = await middleware(
      {
        toolCallId: "call-gmail-attachment",
        toolName: "composio__gmail_get_attachment",
        args: {},
        result: {
          content: [{ type: "text", text: signedUrl }],
          details: {
            mcpServer: "composio",
            structuredContent: {
              data: {
                file: {
                  name: "invoice.pdf",
                  mimetype: "application/pdf",
                  s3url: signedUrl,
                },
              },
            },
          },
        },
      },
      { runtime: "openclaw" },
    );

    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain(signedUrl);
    expect(serialized).toContain("Retry the Composio tool call");
  });
});
