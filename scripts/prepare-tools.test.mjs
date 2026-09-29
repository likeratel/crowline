import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertChecksum,
  assertVercelApiHelp,
  assertVercelLock,
  bundledNpmCliPath,
  executableNames,
  getArtifacts,
  npmCiInvocation,
  platformKey,
  prepareTools,
  sha256,
} from "./prepare-tools.mjs";

test("maps supported macOS and Windows architectures to pinned artifacts", () => {
  const lock = {
    artifacts: {
      "darwin-arm64": { gh: { archive: "gh-arm.zip" }, node: { archive: "node-arm.tar.gz" } },
      "win32-x64": { gh: { archive: "gh-win.zip" }, node: { archive: "node-win.zip" } },
    },
  };

  assert.equal(platformKey("darwin", "arm64"), "darwin-arm64");
  assert.equal(platformKey("win32", "x64"), "win32-x64");
  assert.equal(getArtifacts(lock, "darwin", "arm64").gh.archive, "gh-arm.zip");
  assert.equal(getArtifacts(lock, "win32", "x64").node.archive, "node-win.zip");
  assert.deepEqual(executableNames("darwin"), { gh: "gh", node: "node" });
  assert.deepEqual(executableNames("win32"), { gh: "gh.exe", node: "node.exe" });
});

test("rejects unsupported hosts and incomplete pins", () => {
  assert.throws(() => platformKey("linux", "x64"), /Unsupported tool-bundling platform/);
  assert.throws(() => platformKey("darwin", "ia32"), /Unsupported tool-bundling architecture/);
  assert.throws(() => getArtifacts({ artifacts: {} }, "win32", "arm64"), /No pinned tools/);
});

test("verifies pinned SHA-256 values and detects tampering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crowline-tools-test-"));
  try {
    const fixture = join(directory, "fixture");
    await writeFile(fixture, "verified content");
    const checksum = sha256(await readFile(fixture));

    assert.doesNotThrow(() => assertChecksum(checksum, checksum, "fixture"));
    assert.throws(() => assertChecksum(checksum, "0".repeat(64), "fixture"), /verification failed/);
    assert.throws(() => assertChecksum(checksum, "invalid", "fixture"), /Invalid pinned SHA-256/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires a fully pinned Vercel npm lock", () => {
  const validLock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { vercel: "50.29.0" } },
      "node_modules/vercel": { version: "50.29.0" },
    },
  };

  assert.doesNotThrow(() => assertVercelLock(validLock, "50.29.0"));
  assert.throws(
    () => assertVercelLock({ ...validLock, packages: { ...validLock.packages, "node_modules/vercel": { version: "42.0.0" } } }, "50.29.0"),
    /does not pin/,
  );
});

test("requires the bundled Vercel CLI to expose non-interactive raw API access", () => {
  assert.doesNotThrow(() => assertVercelApiHelp("vercel api --raw --non-interactive"));
  assert.throws(() => assertVercelApiHelp("vercel api --non-interactive"), /required api command options/);
});

test("uses the extracted Node npm CLI when the platform archive includes it", () => {
  const nodeExecutable = "/tools/node.exe";
  const npmCli = bundledNpmCliPath("/extracted/node-v22.23.3-win-x64");

  assert.deepEqual(npmCiInvocation(nodeExecutable, npmCli), {
    command: nodeExecutable,
    argumentsList: [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--fund=false"],
  });
  assert.deepEqual(npmCiInvocation(nodeExecutable, null), {
    command: "npm",
    argumentsList: ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--fund=false"],
  });
});

test("records the direct Windows GitHub CLI archive layout", async () => {
  const lock = JSON.parse(await readFile(new URL("../tools-lock.json", import.meta.url), "utf8"));

  assert.equal(lock.artifacts["win32-x64"].gh.rootDirectory, "");
  assert.equal(lock.artifacts["win32-arm64"].gh.rootDirectory, "");
  assert.equal(lock.artifacts["win32-x64"].gh.executablePath, "bin/gh.exe");
});

test("cleans unverified partial tools after preparation fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crowline-tools-test-"));
  const lockPath = join(directory, "tools-lock.json");
  const toolsDirectory = join(directory, "resources", "tools");

  try {
    await writeFile(lockPath, JSON.stringify({ artifacts: {} }));
    await mkdir(toolsDirectory, { recursive: true });
    await writeFile(join(toolsDirectory, "gh"), "unverified");

    await assert.rejects(
      prepareTools({
        currentArchitecture: "x64",
        currentPlatform: "darwin",
        lockPath,
        toolsDirectory,
      }),
      /No pinned tools/,
    );
    assert.equal(await readFile(join(toolsDirectory, ".gitkeep"), "utf8"), "");
    await assert.rejects(access(join(toolsDirectory, "gh")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
