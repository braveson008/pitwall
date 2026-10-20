const net = require("node:net");
const { createHash } = require("node:crypto");

const TASK_DEVICE_PREFIX = "Pitwall";

function runtimeSlug(value) {
  const slug = String(value || "task")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

function hashRuntimeKey(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function taskRuntimeEnvironment(plan) {
  if (!plan) return {};
  return {
    PITWALL_PREVIEW_PORT: String(plan.previewPort),
    PITWALL_MOBILE_RUNTIME_ID: plan.mobileRuntimeId,
    PITWALL_MOBILE_DEVICE_NAME: plan.mobileDeviceName,
    PORT: String(plan.previewPort),
    RCT_METRO_PORT: String(plan.previewPort),
    EXPO_PACKAGER_PORT: String(plan.previewPort),
  };
}

function createTaskRuntimeAllocator(options = {}) {
  const minPort = Number(options.minPort) || 8100;
  const maxPort = Number(options.maxPort) || 8999;
  const isPortAvailable = options.isPortAvailable || canBindPort;
  const onRelease = options.onRelease || (() => {});
  const plans = new Map();
  const allocatedPorts = new Set();
  let allocationQueue = Promise.resolve();

  async function allocate(payload = {}) {
    const projectId = String(payload.projectId || "project");
    const taskId = String(payload.taskId || payload.sessionId || "task");
    const key = JSON.stringify([projectId, taskId]);
    const existing = plans.get(key);
    if (existing) return existing;

    const count = maxPort - minPort + 1;
    if (count < 1) throw new Error("No task preview ports are configured");
    const start = minPort + (hashRuntimeKey(key) % count);
    let previewPort = 0;
    for (let offset = 0; offset < count; offset += 1) {
      const candidate = minPort + ((start - minPort + offset) % count);
      if (allocatedPorts.has(candidate)) continue;
      if (await isPortAvailable(candidate)) {
        previewPort = candidate;
        break;
      }
    }
    if (!previewPort) throw new Error("No local preview port is available for this task");

    const identity = String(payload.taskIdentifier || payload.taskTitle || taskId).trim() || taskId;
    const unique = createHash("sha256").update(key).digest("hex").slice(0, 12);
    const mobileRuntimeId = `pitwall-${runtimeSlug(identity)}-${unique}`;
    const deviceLabel = identity
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || runtimeSlug(taskId);
    const plan = {
      previewPort,
      mobileRuntimeId,
      mobileDeviceName: `${TASK_DEVICE_PREFIX} ${deviceLabel}-${unique}`,
    };
    allocatedPorts.add(previewPort);
    plans.set(key, plan);
    return plan;
  }

  return {
    allocate(payload = {}) {
      const pending = allocationQueue.then(() => allocate(payload));
      allocationQueue = pending.catch(() => undefined);
      return pending;
    },
    release(payload = {}) {
      const pending = allocationQueue.then(() => {
        const released = [];
        for (const [key, plan] of plans) {
          const [projectId, taskId] = JSON.parse(key);
          if (projectId !== String(payload.projectId || "project")) continue;
          if (payload.taskId !== undefined && taskId !== String(payload.taskId)) continue;
          plans.delete(key);
          allocatedPorts.delete(plan.previewPort);
          released.push(plan);
        }
        if (released.length) onRelease(released);
        return released.length;
      });
      allocationQueue = pending.catch(() => undefined);
      return pending;
    },
  };
}

module.exports = {
  TASK_DEVICE_PREFIX,
  createTaskRuntimeAllocator,
  runtimeSlug,
  taskRuntimeEnvironment,
};
