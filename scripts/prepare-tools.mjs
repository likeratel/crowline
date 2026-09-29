import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "..");
const defaultLockPath = join(repositoryDirectory, "tools-lock.json");
const defaultToolsDirectory = join(repositoryDirectory, "src-tauri", "resources", "tools");
const downloadTimeoutMilliseconds = 120_000;
const commandTimeoutMilliseconds = 120_000;
const npmInstallTimeoutMilliseconds = 300_000;
const apiHelpTimeoutMilliseconds = 30_000;
const npmCiArguments = ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--fund=false"];

export function platformKey(currentPlatform, currentArchitecture) {
  if (currentPlatform !== "darwin" && currentPlatform !== "win32") {
    throw new Error(`Unsupported tool-bundling platform: ${currentPlatform}`);
  }

  if (currentArchitecture !== "arm64" && currentArchitecture !== "x64") {
    throw new Error(`Unsupported tool-bundling architecture: ${currentArchitecture}`);
  }

  return `${currentPlatform}-${currentArchitecture}`;
}

export function executableNames(currentPlatform) {
  if (currentPlatform === "darwin") {
    return { gh: "gh", node: "node" };
  }

  if (currentPlatform === "win32") {
    return { gh: "gh.exe", node: "node.exe" };
  }

  throw new Error(`Unsupported tool-bundling platform: ${currentPlatform}`);
}

export function getArtifacts(lock, currentPlatform, currentArchitecture) {
  const key = platformKey(currentPlatform, currentArchitecture);
  const artifacts = lock.artifacts?.[key];

  if (!artifacts?.gh || !artifacts?.node) {
    throw new Error(`No pinned tools are configured for ${key}`);
  }

  return artifacts;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertChecksum(actual, expected, label) {
  if (!/^[a-f0-9]{64}$/i.test(expected)) {
    throw new Error(`Invalid pinned SHA-256 for ${label}`);
  }

  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA-256 verification failed for ${label}`);
  }
}

export function assertVercelLock(packageLock, version) {
  const rootPackage = packageLock.packages?.[""];
  const vercelPackage = packageLock.packages?.["node_modules/vercel"];

  if (packageLock.lockfileVersion !== 3 || !rootPackage || !vercelPackage) {
    throw new Error("The bundled Vercel package lock must be an npm lockfile v3");
  }

  if (rootPackage.dependencies?.vercel !== version || vercelPackage.version !== version) {
    throw new Error(`The bundled Vercel package lock does not pin vercel@${version}`);
  }
}

export function assertVercelApiHelp(output) {
  const requiredOptions = ["vercel api", "--raw", "--non-interactive"];
  if (requiredOptions.some((option) => !output.includes(option))) {
    throw new Error("Bundled Vercel CLI does not support the required api command options");
  }
}

export function bundledNpmCliPath(nodeRoot) {
  return join(nodeRoot, "node_modules", "npm", "bin", "npm-cli.js");
}

export function npmCiInvocation(nodeExecutable, npmCli) {
  if (npmCli) {
    return { command: nodeExecutable, argumentsList: [npmCli, ...npmCiArguments] };
  }

  return { command: "npm", argumentsList: npmCiArguments };
}

async function run(command, argumentsList, options = {}) {
  await new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(command, argumentsList, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      windowsHide: true,
    });
    const timeoutMilliseconds = options.timeoutMilliseconds ?? commandTimeoutMilliseconds;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`${command} timed out after ${timeoutMilliseconds}ms`));
      }
    }, timeoutMilliseconds);
    const settle = (callback) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        callback();
      }
    };

    child.once("error", (error) => {
      settle(() => reject(new Error(`Could not run ${command}: ${error.message}`)));
    });
    child.once("close", (code) => {
      if (code === 0) {
        settle(resolvePromise);
        return;
      }

      settle(() => reject(new Error(`${command} exited with status ${code ?? "unknown"}`)));
    });
  });
}

async function runCaptured(command, argumentsList, successfulExitCodes = [0], timeoutMilliseconds = commandTimeoutMilliseconds) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(command, argumentsList, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const output = [];
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`${command} timed out after ${timeoutMilliseconds}ms`));
      }
    }, timeoutMilliseconds);
    const settle = (callback) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        callback();
      }
    };

    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.once("error", (error) => settle(() => reject(new Error(`Could not run ${command}: ${error.message}`))));
    child.once("close", (code) => {
      const text = Buffer.concat(output).toString("utf8");
      if (successfulExitCodes.includes(code)) {
        settle(() => resolvePromise(text));
        return;
      }

      settle(() => reject(new Error(`${command} exited with status ${code ?? "unknown"}: ${text.trim()}`)));
    });
  });
}

async function download(url, destination) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), downloadTimeoutMilliseconds);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${url}`);
    }

    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Download timed out after ${downloadTimeoutMilliseconds}ms for ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyFile(path, expectedChecksum, label) {
  const contents = await readFile(path);
  assertChecksum(sha256(contents), expectedChecksum, label);
}

async function extract(archive, destination) {
  await mkdir(destination, { recursive: true });
  await run("tar", ["-xf", archive, "-C", destination], { timeoutMilliseconds: commandTimeoutMilliseconds });
}

async function resetToolsDirectory(toolsDirectory) {
  await rm(toolsDirectory, { recursive: true, force: true });
  await mkdir(toolsDirectory, { recursive: true });
  await writeFile(join(toolsDirectory, ".gitkeep"), "");
}

async function copyExecutable(source, destination, currentPlatform) {
  await copyFile(source, destination);
  if (currentPlatform === "darwin") {
    await chmod(destination, 0o755);
  }
}

async function readPinnedVercelLock(lock, lockPath) {
  const packageLockPath = resolve(dirname(lockPath), lock.vercel.packageLock);
  const contents = await readFile(packageLockPath);
  assertChecksum(sha256(contents), lock.vercel.packageLockSha256, "Vercel package lock");

  const packageLock = JSON.parse(contents.toString("utf8"));
  assertVercelLock(packageLock, lock.vercel.version);
  return { contents, packageLock };
}

async function resolveBundledNpmCli(nodeRoot) {
  const npmCli = bundledNpmCliPath(nodeRoot);
  try {
    await access(npmCli);
    return npmCli;
  } catch {
    return null;
  }
}

async function installVercel({ lock, lockPath, toolsDirectory, nodeExecutable, nodeRoot, scratchDirectory }) {
  const { contents, packageLock } = await readPinnedVercelLock(lock, lockPath);
  const vercelDirectory = join(toolsDirectory, "vercel");
  const npmCache = join(scratchDirectory, "npm-cache");
  const npmConfig = join(scratchDirectory, "npmrc");
  const globalNpmConfig = join(scratchDirectory, "global-npmrc");
  const npm = npmCiInvocation(nodeExecutable, await resolveBundledNpmCli(nodeRoot));

  await mkdir(vercelDirectory, { recursive: true });
  await writeFile(join(vercelDirectory, "package.json"), `${JSON.stringify(packageLock.packages[""], null, 2)}\n`);
  await writeFile(join(vercelDirectory, "package-lock.json"), contents);

  await run(npm.command, npm.argumentsList, {
    cwd: vercelDirectory,
    timeoutMilliseconds: npmInstallTimeoutMilliseconds,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.toLowerCase().startsWith("npm_") && name !== "NODE_AUTH_TOKEN",
        ),
      ),
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_GLOBALCONFIG: globalNpmConfig,
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
      NPM_CONFIG_PREFIX: join(scratchDirectory, "npm-prefix"),
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      NPM_CONFIG_USERCONFIG: npmConfig,
    },
  });

  await access(join(vercelDirectory, "node_modules", "vercel", "dist", "index.js"));
}

async function copyLicenses({ ghRoot, nodeRoot, toolsDirectory }) {
  const licensesDirectory = join(toolsDirectory, "licenses");
  const vercelLicense = join(toolsDirectory, "vercel", "node_modules", "vercel", "LICENSE");

  await mkdir(licensesDirectory, { recursive: true });
  await Promise.all([
    copyFile(join(ghRoot, "LICENSE"), join(licensesDirectory, "github-cli.txt")),
    copyFile(join(nodeRoot, "LICENSE"), join(licensesDirectory, "node.txt")),
    copyFile(vercelLicense, join(licensesDirectory, "vercel-cli.txt")),
  ]);
  await writeFile(
    join(toolsDirectory, "THIRD_PARTY_NOTICES.md"),
    [
      "# Bundled third-party tools",
      "",
      "- GitHub CLI is licensed under MIT; its license is `licenses/github-cli.txt`.",
      "- Node.js is licensed under MIT; its license is `licenses/node.txt`.",
      "- Vercel CLI is licensed under Apache-2.0; its license is `licenses/vercel-cli.txt`.",
      "- License files shipped by Vercel CLI dependencies remain in `vercel/node_modules`.",
      "",
      "Source metadata and pinned versions are recorded in `tools-lock.json`.",
      "",
    ].join("\n"),
  );
}

async function assertBundledTools(toolsDirectory, names) {
  const paths = [
    stat(join(toolsDirectory, names.gh)),
    stat(join(toolsDirectory, names.node)),
    stat(join(toolsDirectory, "vercel", "node_modules", "vercel", "dist", "index.js")),
  ];
  const entries = await Promise.all(paths);

  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("Bundled tools did not produce the required executable files");
  }
}

async function assertVercelApiCommand(toolsDirectory, names) {
  const output = await runCaptured(join(toolsDirectory, names.node), [
    join(toolsDirectory, "vercel", "node_modules", "vercel", "dist", "index.js"),
    "api",
    "--help",
  ], [0, 2], apiHelpTimeoutMilliseconds);
  assertVercelApiHelp(output);
}

export async function prepareTools({
  currentArchitecture = arch(),
  currentPlatform = platform(),
  lockPath = defaultLockPath,
  toolsDirectory = defaultToolsDirectory,
} = {}) {
  let scratchDirectory;

  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    const artifacts = getArtifacts(lock, currentPlatform, currentArchitecture);
    const names = executableNames(currentPlatform);
    await resetToolsDirectory(toolsDirectory);
    scratchDirectory = await mkdtemp(join(tmpdir(), "crowline-tools-"));

    const scratchGhArchive = join(scratchDirectory, artifacts.gh.archive);
    const scratchNodeArchive = join(scratchDirectory, artifacts.node.archive);
    await download(artifacts.gh.url, scratchGhArchive);
    await verifyFile(scratchGhArchive, artifacts.gh.sha256, "GitHub CLI archive");
    await download(artifacts.node.url, scratchNodeArchive);
    await verifyFile(scratchNodeArchive, artifacts.node.sha256, "Node.js archive");

    const ghExtractDirectory = join(scratchDirectory, "gh");
    const nodeExtractDirectory = join(scratchDirectory, "node");
    await extract(scratchGhArchive, ghExtractDirectory);
    await extract(scratchNodeArchive, nodeExtractDirectory);

    const ghRoot = join(ghExtractDirectory, artifacts.gh.rootDirectory);
    const nodeRoot = join(nodeExtractDirectory, artifacts.node.rootDirectory);
    const nodeExecutable = join(nodeRoot, artifacts.node.executablePath);
    await copyExecutable(join(ghRoot, artifacts.gh.executablePath), join(toolsDirectory, names.gh), currentPlatform);
    await copyExecutable(nodeExecutable, join(toolsDirectory, names.node), currentPlatform);
    await installVercel({ lock, lockPath, toolsDirectory, nodeExecutable, nodeRoot, scratchDirectory });
    await copyLicenses({ ghRoot, nodeRoot, toolsDirectory });
    await assertBundledTools(toolsDirectory, names);
    await assertVercelApiCommand(toolsDirectory, names);
  } catch (error) {
    await resetToolsDirectory(toolsDirectory);
    throw new Error(`Unable to prepare bundled tools: ${error.message}`, { cause: error });
  } finally {
    if (scratchDirectory) {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  }
}

async function main() {
  process.stdout.write(`Preparing bundled tools for ${platformKey(platform(), arch())}...\n`);
  await prepareTools();
  process.stdout.write("Bundled tools are ready.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
