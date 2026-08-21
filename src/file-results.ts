import type { AgentToolResultMiddleware } from "openclaw/plugin-sdk/agent-harness";
import { saveMediaSource } from "openclaw/plugin-sdk/media-store";
import { isRecord, normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { COMPOSIO_MCP_SERVER_NAME } from "./config.js";

const COMPOSIO_FILE_MAX_BYTES = 5 * 1024 * 1024;
const STRUCTURED_CONTENT_PREFIX = "structuredContent:\n";

type ComposioFileResult = {
  name: string;
  mimeType: string;
  url: string;
};

function readComposioFileResult(value: unknown): ComposioFileResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const name = normalizeOptionalString(value.name);
  const mimeType = normalizeOptionalString(value.mimetype);
  const url = normalizeOptionalString(value.s3url);
  if (!name || !mimeType || !url) {
    return undefined;
  }
  try {
    if (new URL(url).protocol !== "https:") {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { name, mimeType, url };
}

function replaceResultContent(
  content: Parameters<AgentToolResultMiddleware>[0]["result"]["content"],
  params: { originalUrl: string; replacement: string; structuredContent: Record<string, unknown> },
) {
  const structuredText = `${STRUCTURED_CONTENT_PREFIX}${JSON.stringify(params.structuredContent, null, 2)}`;
  return content.map((block) => {
    if (block.type !== "text") {
      return block;
    }
    if (block.text.startsWith(STRUCTURED_CONTENT_PREFIX)) {
      return { ...block, text: structuredText };
    }
    return { ...block, text: block.text.split(params.originalUrl).join(params.replacement) };
  });
}

export function createComposioFileResultMiddleware(
  params: {
    onSaveFailure?: () => void;
  } = {},
): AgentToolResultMiddleware {
  return async (event) => {
    if (event.isError === true || !isRecord(event.result.details)) {
      return;
    }
    const details = event.result.details;
    if (details.mcpServer !== COMPOSIO_MCP_SERVER_NAME || !isRecord(details.structuredContent)) {
      return;
    }
    const structuredContent = details.structuredContent;
    if (!isRecord(structuredContent.data)) {
      return;
    }
    const data = structuredContent.data;
    const file = readComposioFileResult(data.file);
    if (!file) {
      return;
    }

    let replacement: string;
    let materializedFile: Record<string, unknown>;
    try {
      const saved = await saveMediaSource(file.url, undefined, "outbound", COMPOSIO_FILE_MAX_BYTES);
      replacement = saved.path;
      materializedFile = {
        name: file.name,
        mimetype: saved.contentType ?? file.mimeType,
        media: `MEDIA:${saved.path}`,
      };
    } catch {
      params.onSaveFailure?.();
      replacement = "<file unavailable>";
      materializedFile = {
        name: file.name,
        mimetype: file.mimeType,
        error: "OpenClaw could not save this file. Retry the Composio tool call.",
      };
    }

    const transformedStructuredContent = {
      ...structuredContent,
      data: { ...data, file: materializedFile },
    };
    return {
      result: {
        ...event.result,
        content: replaceResultContent(event.result.content, {
          originalUrl: file.url,
          replacement,
          structuredContent: transformedStructuredContent,
        }),
        details: { ...details, structuredContent: transformedStructuredContent },
      },
    };
  };
}
