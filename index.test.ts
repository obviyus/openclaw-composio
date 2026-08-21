/** Plugin boundary tests for Composio MCP file materialization. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMediaSource = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/media-store", () => ({ saveMediaSource }));

import plugin from "./index.js";

function registerFileResultMiddleware() {
  const registerAgentToolResultMiddleware = vi.fn();
  plugin.register({
    config: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    runtime: { state: { openKeyedStore: vi.fn() } },
    registerMcpServerConnectionResolver: vi.fn(),
    registerAgentToolResultMiddleware,
  } as never);
  return registerAgentToolResultMiddleware.mock.calls[0]?.[0];
}

describe("composio plugin", () => {
  beforeEach(() => saveMediaSource.mockReset());

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
