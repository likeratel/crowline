import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const originalService =
  'func keyringServiceName(hostname string) string {\n\treturn "gh:" + hostname\n}';
const isolatedService = `func keyringServiceName(hostname string) string {
	if namespace := os.Getenv("CROWLINE_GH_KEYRING_NAMESPACE"); namespace != "" {
		return "gh:io.crowline.desktop:" + namespace + ":" + hostname
	}
	return "gh:" + hostname
}`;

export function patchGithubKeyring(source) {
  if (source.split(originalService).length !== 2) {
    throw new Error(
      "GitHub keyring patch anchor changed; refusing an unverified helper",
    );
  }
  return source.replace(originalService, isolatedService);
}

export function isolatedGithubName(platform) {
  return platform === "win32" ? "gh-isolated.exe" : "gh-isolated";
}

export async function buildIsolatedGithub({
  pin,
  scratchDirectory,
  toolsDirectory,
  currentPlatform,
  currentArchitecture,
  run,
  runCaptured,
  download,
  extract,
  verifyFile,
}) {
  const goVersion = await runCaptured("go", ["version"]);
  if (!goVersion.includes(`go${pin.goVersion} `)) {
    throw new Error(
      `Building isolated GitHub authentication requires Go ${pin.goVersion}`,
    );
  }
  const archive = join(scratchDirectory, "github-source.tar.gz");
  await download(pin.sourceUrl, archive);
  await verifyFile(archive, pin.sourceSha256, "GitHub CLI source");
  const extracted = join(scratchDirectory, "github-source");
  await extract(archive, extracted);
  const sourceDirectory = join(extracted, pin.rootDirectory);
  const configPath = join(sourceDirectory, "internal", "config", "config.go");
  await writeFile(
    configPath,
    patchGithubKeyring(await readFile(configPath, "utf8")),
  );
  await copyFile(
    new URL("./github-isolation_test.go", import.meta.url),
    join(sourceDirectory, "internal", "config", "crowline_isolation_test.go"),
  );
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !name.startsWith("GH_") &&
          !name.startsWith("GITHUB_") &&
          name !== "CROWLINE_GH_KEYRING_NAMESPACE",
      ),
    ),
    CGO_ENABLED: "0",
    GOENV: "off",
    GOFLAGS: "",
    GOEXPERIMENT: "",
    GOTOOLCHAIN: "local",
    GOWORK: "off",
    GOPROXY: "https://proxy.golang.org",
    GOSUMDB: "sum.golang.org",
    GOOS: currentPlatform === "win32" ? "windows" : "darwin",
    GOARCH: currentArchitecture === "x64" ? "amd64" : "arm64",
  };
  const options = { cwd: sourceDirectory, env, timeoutMilliseconds: 600_000 };
  await run(
    "go",
    [
      "test",
      "-mod=readonly",
      "./internal/config",
      "-run",
      "^TestCrowline",
      "-count=1",
    ],
    options,
  );
  await run(
    "go",
    [
      "build",
      "-mod=readonly",
      "-trimpath",
      "-buildvcs=false",
      "-ldflags",
      `-s -w -X github.com/cli/cli/v2/internal/build.Version=${pin.version}`,
      "-o",
      join(toolsDirectory, isolatedGithubName(currentPlatform)),
      "./cmd/gh",
    ],
    options,
  );
  await copyFile(
    configPath,
    join(toolsDirectory, "github-isolated-config.go.txt"),
  );
  await writeFile(
    join(toolsDirectory, "github-isolated-source.json"),
    `${JSON.stringify(pin, null, 2)}\n`,
  );
}
