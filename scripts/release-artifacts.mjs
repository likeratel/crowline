import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

const commandOptions = Object.freeze({
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

function commandOutput(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .map((value) => value.toString().trim())
    .filter(Boolean)
    .join("\n");
}

export function runCommand(command, argumentsList) {
  const result = spawnSync(command, argumentsList, commandOptions);
  const output = commandOutput(result);
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed${output ? `:\n${output}` : ""}`);
  }
  return output;
}

export function findReleaseArtifacts(root) {
  const found = { apps: [], dmgs: [], windowsInstallers: [] };
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) {
        found.apps.push(path);
      } else if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".dmg")) {
        found.dmgs.push(path);
      } else if (entry.isFile() && /(?:\.msi|\.exe)$/i.test(entry.name)) {
        found.windowsInstallers.push(path);
      }
    }
  };
  visit(root);
  return {
    apps: found.apps.sort(),
    dmgs: found.dmgs.sort(),
    windowsInstallers: found.windowsInstallers.sort(),
  };
}

function exactlyOne(values, label) {
  if (values.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${values.length}`);
  }
  return values[0];
}

function requiredEnvironmentValue(name, environment) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required for release artifact verification`);
  }
  return value;
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertDeveloperIdSignature(details, { requireRuntime, label }) {
  const checks = [
    [
      /^Authority=Developer ID Application:.+$/m,
      `${label} is not Developer ID signed`,
    ],
    [/^TeamIdentifier=[A-Z0-9]{10}$/m, `${label} has no Apple team identifier`],
    [/^Timestamp=.+$/m, `${label} has no secure timestamp`],
  ];
  if (requireRuntime) {
    checks.push([
      /^(?:Runtime Version=|CodeDirectory .*flags=.*runtime)/m,
      `${label} lacks hardened runtime`,
    ]);
  }
  for (const [pattern, message] of checks) {
    if (!pattern.test(details)) {
      throw new Error(message);
    }
  }
  if (/^Signature=adhoc$/m.test(details)) {
    throw new Error(`${label} is ad-hoc signed`);
  }
}

export function assertAppleSignature(
  details,
  { identity, teamId, requireRuntime, label },
) {
  assertDeveloperIdSignature(details, { requireRuntime, label });
  if (!new RegExp(`^Authority=${escaped(identity)}$`, "m").test(details)) {
    throw new Error(`${label} has the wrong signing identity`);
  }
  if (!new RegExp(`^TeamIdentifier=${escaped(teamId)}$`, "m").test(details)) {
    throw new Error(`${label} has the wrong Apple team`);
  }
}

function verifyMacArtifact(path, environment, { requireRuntime, type, label }) {
  runCommand("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    path,
  ]);
  const details = runCommand("codesign", ["-dv", "--verbose=4", path]);
  assertAppleSignature(details, {
    identity: environment.APPLE_SIGNING_IDENTITY,
    teamId: environment.APPLE_TEAM_ID,
    requireRuntime,
    label,
  });
  runCommand("xcrun", ["stapler", "validate", path]);
  const assessment = runCommand("spctl", [
    "--assess",
    "--type",
    type,
    "--verbose=2",
    ...(type === "open" ? ["--context", "context:primary-signature"] : []),
    path,
  ]);
  if (!/source=Notarized Developer ID/.test(assessment)) {
    throw new Error(`${label} did not assess as Notarized Developer ID`);
  }
}

export function verifyMacRelease(bundleDirectory, environment = process.env) {
  const identity = requiredEnvironmentValue(
    "APPLE_SIGNING_IDENTITY",
    environment,
  );
  const teamId = requiredEnvironmentValue("APPLE_TEAM_ID", environment);
  const artifacts = findReleaseArtifacts(bundleDirectory);
  const app = exactlyOne(artifacts.apps, "macOS app bundle");
  const dmg = exactlyOne(artifacts.dmgs, "macOS disk image");
  const expectedSigner = {
    APPLE_SIGNING_IDENTITY: identity,
    APPLE_TEAM_ID: teamId,
  };
  verifyMacArtifact(app, expectedSigner, {
    requireRuntime: true,
    type: "execute",
    label: "macOS app bundle",
  });
  verifyMacArtifact(dmg, expectedSigner, {
    requireRuntime: false,
    type: "open",
    label: "macOS disk image",
  });
  return { app, dmg };
}

export function verifyWindowsRelease(
  bundleDirectory,
  environment = process.env,
) {
  const expectedThumbprint = requiredEnvironmentValue(
    "WINDOWS_CERTIFICATE_THUMBPRINT",
    environment,
  );
  const { windowsInstallers } = findReleaseArtifacts(bundleDirectory);
  if (windowsInstallers.length === 0) {
    throw new Error("No Windows installer artifacts were found");
  }
  for (const installer of windowsInstallers) {
    runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      resolve(scriptDirectory, "release-verify-windows.ps1"),
      "-ArtifactPath",
      installer,
      "-ExpectedThumbprint",
      expectedThumbprint,
    ]);
  }
  return windowsInstallers;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const platform = argumentValue("--platform");
    const bundleDirectory = argumentValue("--bundle-dir");
    if (!bundleDirectory) {
      throw new Error("--bundle-dir is required");
    }
    const count =
      platform === "macos"
        ? Object.keys(verifyMacRelease(bundleDirectory)).length
        : platform === "windows"
          ? verifyWindowsRelease(bundleDirectory).length
          : (() => {
              throw new Error(
                `Unsupported release platform: ${platform || "(empty)"}`,
              );
            })();
    process.stdout.write(
      `Verified ${count} trusted ${platform} release artifacts.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
