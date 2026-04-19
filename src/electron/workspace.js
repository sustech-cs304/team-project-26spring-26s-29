const fs = require("node:fs/promises");
const path = require("node:path");

function resolveDefaultWorkspacePath({ configPath }) {
  return path.resolve(path.dirname(configPath), "workspace");
}

function normalizeWorkspacePath(value, { configPath }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return resolveDefaultWorkspacePath({ configPath });
  }
  return path.resolve(text);
}

function isSameOrDescendant(parentPath, targetPath) {
  const parent = path.resolve(parentPath);
  const target = path.resolve(targetPath);
  return target === parent || target.startsWith(`${parent}${path.sep}`);
}

function assertSafeWorkspacePath(workspacePath, { protectedPaths = [] } = {}) {
  const resolved = path.resolve(workspacePath);
  const root = path.parse(resolved).root;

  if (resolved === root) {
    throw new Error("Workspace path cannot be a filesystem root.");
  }

  for (const protectedPath of protectedPaths) {
    if (!protectedPath) {
      continue;
    }

    if (isSameOrDescendant(resolved, protectedPath)) {
      throw new Error(`Workspace path cannot contain protected path: ${protectedPath}`);
    }
  }
}

async function resetWorkspace(workspacePath) {
  const resolved = path.resolve(workspacePath);
  await fs.mkdir(resolved, { recursive: true });

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(resolved, entry.name), {
        force: true,
        recursive: true,
      })
    )
  );

  await fs.mkdir(path.join(resolved, "inputs"), { recursive: true });
  await fs.mkdir(path.join(resolved, "outputs"), { recursive: true });
  return resolved;
}

module.exports = {
  assertSafeWorkspacePath,
  normalizeWorkspacePath,
  resetWorkspace,
  resolveDefaultWorkspacePath,
};
