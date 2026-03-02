import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream } from "@mariozechner/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountStore } from "../src/types.js";

const refreshMock = vi.fn();
const streamSimpleMock = vi.fn();

let inMemoryStore: AccountStore;

function createAssistantMessage(modelId: string, text: string): AssistantMessage {
  return {
    role: "assistant",
    content: text.length > 0 ? [{ type: "text", text }] : [],
    api: "google-gemini-cli",
    provider: "google-antigravity",
    model: modelId,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0
      }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
}

function createErrorStream(modelId: string, errorMessage: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  queueMicrotask(() => {
    stream.push({
      type: "error",
      reason: "error",
      error: {
        ...createAssistantMessage(modelId, ""),
        stopReason: "error",
        errorMessage
      }
    });
    stream.end();
  });

  return stream;
}

function createSuccessStream(modelId: string, text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  queueMicrotask(() => {
    const message = createAssistantMessage(modelId, text);
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });

  return stream;
}

async function collectEvents(stream: AssistantMessageEventStream) {
  const events = [] as Array<{ type: string; errorMessage?: string }>;
  for await (const event of stream) {
    if (event.type === "error") {
      const errorMessage = event.error.errorMessage;
      if (typeof errorMessage === "string") {
        events.push({ type: event.type, errorMessage });
      } else {
        events.push({ type: event.type });
      }
      continue;
    }

    events.push({ type: event.type });
  }
  return events;
}

vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-ai")>("@mariozechner/pi-ai");
  return {
    ...actual,
    refreshAntigravityToken: (...args: unknown[]) => refreshMock(...args),
    streamSimpleGoogleGeminiCli: (...args: unknown[]) => streamSimpleMock(...args)
  };
});

vi.mock("../src/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/storage.js")>("../src/storage.js");

  return {
    ...actual,
    withLoadedAccountStore: async <T>(callback: (store: AccountStore) => Promise<T> | T) => callback(inMemoryStore),
    mutateAccountStore: async <T>(
      mutator: (store: AccountStore) => Promise<{ store: AccountStore; result: T }> | { store: AccountStore; result: T }
    ) => {
      const { store, result } = await mutator(inMemoryStore);
      inMemoryStore = store;
      return result;
    }
  };
});

function createStore(): AccountStore {
  return {
    version: 1,
    accounts: [
      {
        email: "first@example.com",
        refreshToken: "refresh-1",
        projectId: "project-1",
        enabled: true,
        addedAt: 1,
        lastUsed: null,
        rateLimitResetTimes: {}
      },
      {
        email: "second@example.com",
        refreshToken: "refresh-2",
        projectId: "project-2",
        enabled: true,
        addedAt: 2,
        lastUsed: null,
        rateLimitResetTimes: {}
      }
    ],
    activeIndexByFamily: {
      claude: 0,
      gemini: 0
    }
  };
}

beforeEach(() => {
  vi.resetModules();
  refreshMock.mockReset();
  streamSimpleMock.mockReset();
  inMemoryStore = createStore();
});

describe("stream rotation", () => {
  it("rotates to the next account when first account is rate-limited", async () => {
    const modelId = "claude-sonnet-4-5";

    refreshMock.mockResolvedValueOnce({
      refresh: "refresh-1",
      access: "access-1",
      expires: Date.now() + 60_000,
      projectId: "project-1"
    });
    refreshMock.mockResolvedValueOnce({
      refresh: "refresh-2",
      access: "access-2",
      expires: Date.now() + 60_000,
      projectId: "project-2"
    });

    streamSimpleMock.mockImplementationOnce(() =>
      createErrorStream(modelId, "Cloud Code Assist API error (429): Your quota will reset after 30s")
    );
    streamSimpleMock.mockImplementationOnce(() => createSuccessStream(modelId, "ok from second account"));

    const { streamWithAccountRotation } = await import("../src/stream.js");

    const stream = streamWithAccountRotation(
      {
        id: modelId,
        name: modelId,
        api: "google-antigravity-multi-api",
        provider: "google-antigravity-multi",
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_192
      },
      {
        messages: [],
        systemPrompt: "You are helpful"
      }
    );

    const events = await collectEvents(stream);

    expect(events.map((event) => event.type)).toEqual(["start", "done"]);
    expect(streamSimpleMock).toHaveBeenCalledTimes(2);
    expect(inMemoryStore.accounts[0]?.rateLimitResetTimes.claude).toBeGreaterThan(Date.now());
    expect(inMemoryStore.activeIndexByFamily.claude).toBe(1);
    expect(inMemoryStore.accounts[1]?.lastUsed).not.toBeNull();
  });

  it("disables invalid_grant account and continues with remaining pool", async () => {
    const modelId = "gemini-3-pro-high";

    refreshMock.mockRejectedValueOnce(new Error("Token refresh failed: invalid_grant"));
    refreshMock.mockResolvedValueOnce({
      refresh: "refresh-2",
      access: "access-2",
      expires: Date.now() + 60_000,
      projectId: "project-2"
    });

    streamSimpleMock.mockImplementationOnce(() => createSuccessStream(modelId, "ok from second account"));

    const { streamWithAccountRotation } = await import("../src/stream.js");

    const stream = streamWithAccountRotation(
      {
        id: modelId,
        name: modelId,
        api: "google-antigravity-multi-api",
        provider: "google-antigravity-multi",
        baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_192
      },
      {
        messages: []
      }
    );

    const events = await collectEvents(stream);

    expect(events.map((event) => event.type)).toEqual(["start", "done"]);
    expect(inMemoryStore.accounts[0]?.enabled).toBe(false);
    expect(inMemoryStore.accounts[0]?.verificationRequired).toBe(true);
    expect(inMemoryStore.activeIndexByFamily.gemini).toBe(1);
  });
});
