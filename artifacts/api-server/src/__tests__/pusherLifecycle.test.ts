import { describe, it, expect } from "vitest";

interface MockChannel {
  name: string;
  bindings: Map<string, Function>;
  unbound: string[];
}

interface MockClient {
  id: number;
  key: string;
  channels: Map<string, MockChannel>;
  disconnected: boolean;
  unsubscribed: string[];
}

let nextId = 0;
const allClients: MockClient[] = [];

function resetTracking() {
  nextId = 0;
  allClients.length = 0;
}

function createMockPusherClass() {
  return class MockPusher {
    _mock: MockClient;
    constructor(key: string, _opts: Record<string, unknown>) {
      const client: MockClient = {
        id: nextId++,
        key,
        channels: new Map(),
        disconnected: false,
        unsubscribed: [],
      };
      allClients.push(client);
      this._mock = client;
    }
    subscribe(channelName: string) {
      const ch: MockChannel = {
        name: channelName,
        bindings: new Map(),
        unbound: [],
      };
      this._mock.channels.set(channelName, ch);
      return {
        bind: (event: string, fn: Function) => {
          ch.bindings.set(event, fn);
        },
        unbind: (event: string, _fn: Function) => {
          ch.unbound.push(event);
          ch.bindings.delete(event);
        },
      };
    }
    unsubscribe(channelName: string) {
      this._mock.unsubscribed.push(channelName);
    }
    disconnect() {
      this._mock.disconnected = true;
    }
  };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function replicateLifecycle(
  threadId: string,
  MockPusher: ReturnType<typeof createMockPusherClass>,
  credentialDelay = 1,
  importDelay = 1,
) {
  let cancelled = false;
  let cleanup: (() => void) | null = null;

  const settled = (async () => {
    try {
      await delay(credentialDelay);
      if (cancelled) return;

      const credentials = { key: "test-key", cluster: "us2" };
      const authEndpoint = "/m/realtime/auth";

      await delay(importDelay);
      if (cancelled) return;

      const client = new MockPusher(credentials.key, {
        cluster: credentials.cluster,
        authEndpoint,
      });

      if (cancelled) {
        client.disconnect();
        return;
      }

      const channelName = `private-thread-${threadId}`;
      const ch = client.subscribe(channelName);
      const onCreated = () => {};
      ch.bind("message.created", onCreated);

      cleanup = () => {
        ch.unbind("message.created", onCreated);
        client.unsubscribe(channelName);
        client.disconnect();
      };
    } catch {
      /* mirrors Messages.tsx catch block */
    }
  })();

  return {
    settled,
    teardown() {
      cancelled = true;
      if (cleanup) cleanup();
    },
  };
}

describe("Pusher lifecycle — runtime concurrent simulation", () => {
  it("50 concurrent mount/unmount cycles produce 50 connections, all cleaned up", async () => {
    resetTracking();
    const MockPusher = createMockPusherClass();
    const lifecycles: ReturnType<typeof replicateLifecycle>[] = [];

    for (let i = 0; i < 50; i++) {
      lifecycles.push(replicateLifecycle(`thread-${i}`, MockPusher));
    }

    await Promise.all(lifecycles.map((l) => l.settled));

    expect(allClients.length).toBe(50);
    expect(allClients.every((c) => !c.disconnected)).toBe(true);
    expect(allClients.every((c) => c.channels.size === 1)).toBe(true);

    for (const lc of lifecycles) {
      lc.teardown();
    }

    expect(allClients.every((c) => c.disconnected)).toBe(true);
    expect(
      allClients.every((c) => c.unsubscribed.length === 1),
    ).toBe(true);
    for (const c of allClients) {
      for (const ch of c.channels.values()) {
        expect(ch.bindings.size).toBe(0);
        expect(ch.unbound).toContain("message.created");
      }
    }
  });

  it("cancel during credential fetch: no Pusher client created", async () => {
    resetTracking();
    const MockPusher = createMockPusherClass();

    const lc = replicateLifecycle("thread-early", MockPusher, 50, 1);
    lc.teardown();
    await lc.settled;

    expect(allClients.length).toBe(0);
  });

  it("cancel during import: no Pusher client created", async () => {
    resetTracking();
    const MockPusher = createMockPusherClass();

    const lc = replicateLifecycle("thread-mid", MockPusher, 1, 50);
    await delay(5);
    lc.teardown();
    await lc.settled;

    expect(allClients.length).toBe(0);
  });

  it("cancel after client construction: immediate disconnect, no subscribe", async () => {
    resetTracking();
    const MockPusher = createMockPusherClass();

    let cancelled = false;
    let cleanupFn: (() => void) | null = null;

    const settled = (async () => {
      const credentials = { key: "test-key", cluster: "us2" };
      const authEndpoint = "/m/realtime/auth";

      const client = new MockPusher(credentials.key, {
        cluster: credentials.cluster,
        authEndpoint,
      });

      cancelled = true;

      if (cancelled) {
        client.disconnect();
        return;
      }

      const channelName = `private-thread-post-construct`;
      const ch = client.subscribe(channelName);
      const onCreated = () => {};
      ch.bind("message.created", onCreated);
      cleanupFn = () => {
        ch.unbind("message.created", onCreated);
        client.unsubscribe(channelName);
        client.disconnect();
      };
    })();

    await settled;
    if (cleanupFn) cleanupFn();

    expect(allClients.length).toBe(1);
    const client = allClients[0]!;
    expect(client.disconnected).toBe(true);
    expect(client.channels.size).toBe(0);
  });

  it("mixed: 25 normal + 25 early-cancel — only 25 clients survive setup", async () => {
    resetTracking();
    const MockPusher = createMockPusherClass();
    const lifecycles: ReturnType<typeof replicateLifecycle>[] = [];

    for (let i = 0; i < 25; i++) {
      lifecycles.push(replicateLifecycle(`thread-norm-${i}`, MockPusher, 1, 1));
    }
    for (let i = 0; i < 25; i++) {
      const lc = replicateLifecycle(`thread-cancel-${i}`, MockPusher, 50, 50);
      lc.teardown();
      lifecycles.push(lc);
    }

    await Promise.all(lifecycles.map((l) => l.settled));

    const connected = allClients.filter((c) => !c.disconnected);
    expect(connected.length).toBe(25);

    for (const lc of lifecycles) {
      lc.teardown();
    }

    expect(allClients.every((c) => c.disconnected)).toBe(true);
  });

  it("channel naming: each thread gets its own private-thread-<id> channel", async () => {
    resetTracking();
    const MockPusher = createMockPusherClass();
    const threadIds = ["aaa", "bbb", "ccc"];
    const lifecycles = threadIds.map((id) =>
      replicateLifecycle(id, MockPusher),
    );

    await Promise.all(lifecycles.map((l) => l.settled));

    for (let i = 0; i < threadIds.length; i++) {
      const client = allClients[i]!;
      expect(client.channels.has(`private-thread-${threadIds[i]}`)).toBe(true);
    }

    for (const lc of lifecycles) lc.teardown();
  });

  it("teardown order: unbind before unsubscribe before disconnect", async () => {
    resetTracking();
    const MockPusher = createMockPusherClass();
    const callOrder: string[] = [];

    const OrigSubscribe = MockPusher.prototype.subscribe;
    MockPusher.prototype.subscribe = function (channelName: string) {
      const result = OrigSubscribe.call(this, channelName);
      const origUnbind = result.unbind;
      result.unbind = function (...args: [string, Function]) {
        callOrder.push("unbind");
        return origUnbind.apply(this, args);
      };
      return result;
    };
    const origUnsub = MockPusher.prototype.unsubscribe;
    MockPusher.prototype.unsubscribe = function (channelName: string) {
      callOrder.push("unsubscribe");
      return origUnsub.call(this, channelName);
    };
    const origDisconnect = MockPusher.prototype.disconnect;
    MockPusher.prototype.disconnect = function () {
      callOrder.push("disconnect");
      return origDisconnect.call(this);
    };

    const lc = replicateLifecycle("order-test", MockPusher);
    await lc.settled;
    lc.teardown();

    expect(callOrder).toEqual(["unbind", "unsubscribe", "disconnect"]);
  });
});
