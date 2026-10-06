import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDeveloperIdSignature,
  findReleaseArtifacts,
  runCommand,
} from "./release-artifacts.mjs";

function required(name, environment) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required for DMG notarization`);
  }
  return value;
}

export function notarizeMacDmg(
  bundleDirectory,
  environment = process.env,
  keychainProfile,
) {
  const dmgs = findReleaseArtifacts(bundleDirectory).dmgs;
  if (dmgs.length !== 1) {
    throw new Error(
      `Expected exactly one macOS disk image; found ${dmgs.length}`,
    );
  }
  runCommand("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    dmgs[0],
  ]);
  assertDeveloperIdSignature(
    runCommand("codesign", ["-dv", "--verbose=4", dmgs[0]]),
    {
      requireRuntime: false,
      label: "macOS disk image",
    },
  );
  const profile = keychainProfile || environment.APPLE_NOTARY_KEYCHAIN_PROFILE;
  const authentication = [];
  if (profile) {
    authentication.push("--keychain-profile", profile);
  } else {
    const privateKeyPath = required("APPLE_API_KEY_PATH", environment);
    if (!existsSync(privateKeyPath)) {
      throw new Error(
        "APPLE_API_KEY_PATH does not point to a readable private key",
      );
    }
    authentication.push(
      "--key",
      privateKeyPath,
      "--key-id",
      required("APPLE_API_KEY", environment),
      "--issuer",
      required("APPLE_API_ISSUER", environment),
    );
  }
  runCommand("xcrun", [
    "notarytool",
    "submit",
    dmgs[0],
    ...authentication,
    "--wait",
  ]);
  runCommand("xcrun", ["stapler", "staple", dmgs[0]]);
  return dmgs[0];
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
    const bundleDirectory = argumentValue("--bundle-dir");
    if (!bundleDirectory) {
      throw new Error("--bundle-dir is required");
    }
    notarizeMacDmg(
      bundleDirectory,
      process.env,
      argumentValue("--keychain-profile"),
    );
    process.stdout.write("The macOS disk image was notarized and stapled.\n");
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
