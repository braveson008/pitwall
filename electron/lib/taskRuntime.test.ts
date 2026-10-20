import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createTaskRuntimeAllocator, runtimeSlug, taskRuntimeEnvironment } = require("./taskRuntime.cjs");

describe("task runtime allocation", () => {
  it("keeps one stable runtime per task and separates different tasks", async () => {
    const allocator = createTaskRuntimeAllocator({ minPort: 8100, maxPort: 8102, isPortAvailable: async () => true });
    const first = await allocator.allocate({ projectId: "app", taskId: "one", taskIdentifier: "WEB-101" });
    const same = await allocator.allocate({ projectId: "app", taskId: "one", taskIdentifier: "WEB-101" });
    const second = await allocator.allocate({ projectId: "app", taskId: "two", taskIdentifier: "WEB-102" });

    expect(same).toEqual(first);
    expect(second.previewPort).not.toBe(first.previewPort);
    expect(first.mobileDeviceName).toMatch(/^Pitwall WEB-101-[a-f0-9]{12}$/);
    expect(second.mobileRuntimeId).toMatch(/^braveli-web-102-[a-f0-9]{12}$/);
  });

  it("skips ports that another process is already using", async () => {
    const allocator = createTaskRuntimeAllocator({
      minPort: 8200,
      maxPort: 8202,
      isPortAvailable: async (port: number) => port !== 8200,
    });
    const plan = await allocator.allocate({ projectId: "app", taskId: "task" });
    expect(plan.previewPort).not.toBe(8200);
  });

  it("serializes concurrent task allocations so bulk starts cannot share a port", async () => {
    const allocator = createTaskRuntimeAllocator({
      minPort: 8300,
      maxPort: 8302,
      isPortAvailable: async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return true;
      },
    });
    const plans = await Promise.all([
      allocator.allocate({ projectId: "app", taskId: "one" }),
      allocator.allocate({ projectId: "app", taskId: "two" }),
      allocator.allocate({ projectId: "app", taskId: "three" }),
    ]);
    expect(new Set(plans.map((plan: { previewPort: number }) => plan.previewPort)).size).toBe(3);
  });

  it("separates mobile devices for identical task labels in different projects", async () => {
    const allocator = createTaskRuntimeAllocator({ isPortAvailable: async () => true });
    const first = await allocator.allocate({ projectId: "a", taskId: "one", taskTitle: "Fix login" });
    const other = await allocator.allocate({ projectId: "b", taskId: "one", taskTitle: "Fix login" });
    expect(other.mobileRuntimeId).not.toBe(first.mobileRuntimeId);
    expect(other.mobileDeviceName).not.toBe(first.mobileDeviceName);
  });

  it("releases historical reservations and still skips live preview servers", async () => {
    const busy = new Set<number>();
    const allocator = createTaskRuntimeAllocator({ minPort: 8400, maxPort: 8401, isPortAvailable: async (port: number) => !busy.has(port) });
    for (let index = 0; index < 5; index += 1) {
      await allocator.allocate({ projectId: "a", taskId: String(index) });
      expect(await allocator.release({ projectId: "a", taskId: String(index) })).toBe(1);
    }
    const live = await allocator.allocate({ projectId: "a", taskId: "live" });
    busy.add(live.previewPort);
    await allocator.release({ projectId: "a" });
    const next = await allocator.allocate({ projectId: "b", taskId: "new" });
    expect(next.previewPort).not.toBe(live.previewPort);
    await expect(allocator.allocate({ projectId: "c", taskId: "full" })).rejects.toThrow("No local preview port");
  });

  it("hands released plans to onRelease so their simulators can be deleted", async () => {
    const released: string[][] = [];
    const allocator = createTaskRuntimeAllocator({
      isPortAvailable: async () => true,
      onRelease: (plans: { mobileDeviceName: string }[]) => released.push(plans.map((plan) => plan.mobileDeviceName)),
    });
    const first = await allocator.allocate({ projectId: "a", taskId: "one" });
    const second = await allocator.allocate({ projectId: "a", taskId: "two" });
    await allocator.release({ projectId: "a", taskId: "one" });
    await allocator.release({ projectId: "a", taskId: "one" });
    await allocator.release({ projectId: "a" });
    expect(released).toEqual([[first.mobileDeviceName], [second.mobileDeviceName]]);
  });

  it("serializes release with an in-flight allocation", async () => {
    const allocator = createTaskRuntimeAllocator({ minPort: 8500, maxPort: 8500, isPortAvailable: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return true;
    } });
    const allocated = allocator.allocate({ projectId: "a", taskId: "first" });
    const released = allocator.release({ projectId: "a" });
    await allocated;
    expect(await released).toBe(1);
    await expect(allocator.allocate({ projectId: "b", taskId: "next" })).resolves.toHaveProperty("previewPort", 8500);
  });

  it("provides the common web and mobile bundler environment", () => {
    expect(taskRuntimeEnvironment({ previewPort: 8312, mobileRuntimeId: "braveli-web-1", mobileDeviceName: "Pitwall WEB-1" })).toMatchObject({
      BRAVELI_PREVIEW_PORT: "8312",
      PORT: "8312",
      RCT_METRO_PORT: "8312",
      EXPO_PACKAGER_PORT: "8312",
      BRAVELI_MOBILE_DEVICE_NAME: "Pitwall WEB-1",
    });
    expect(runtimeSlug(" [WEB 1] Login / Fix ")).toBe("web-1-login-fix");
  });
});
