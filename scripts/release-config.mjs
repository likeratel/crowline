import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function normalizedThumbprint(value) {
  const thumbprint = value?.replace(/\s/g, "").toUpperCase() ?? "";
  if (!/^[A-F0-9]{40}$/.test(thumbprint)) {
    throw new Error(
      "WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 thumbprint",
    );
  }
  return thumbprint;
}

function timestampUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WINDOWS_TIMESTAMP_URL must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("WINDOWS_TIMESTAMP_URL must use HTTPS");
  }
  return url.href;
}

export function releaseConfig(platform, environment = process.env) {
  if (platform === "macos") {
    return { bundle: { createUpdaterArtifacts: true } };
  }
  if (platform === "windows") {
    return {
      bundle: {
        createUpdaterArtifacts: true,
        windows: {
          certificateThumbprint: normalizedThumbprint(
            environment.WINDOWS_CERTIFICATE_THUMBPRINT,
          ),
          digestAlgorithm: "sha256",
          timestampUrl: timestampUrl(environment.WINDOWS_TIMESTAMP_URL),
          tsp: true,
        },
      },
    };
  }
  throw new Error(`Unsupported release platform: ${platform || "(empty)"}`);
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
    const output = argumentValue("--output");
    if (!output) {
      throw new Error("--output is required");
    }
    const config = releaseConfig(argumentValue("--platform"));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    process.stdout.write(
      `Prepared release configuration for ${argumentValue("--platform")}.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
