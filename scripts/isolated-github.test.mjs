import assert from "node:assert/strict";
import test from "node:test";
import { isolatedGithubName, patchGithubKeyring } from "./isolated-github.mjs";

test("namespaces every upstream keyring operation through its shared service resolver", () => {
  const original =
    'func keyringServiceName(hostname string) string {\n\treturn "gh:" + hostname\n}';
  const patched = patchGithubKeyring(original);
  assert.match(patched, /CROWLINE_GH_KEYRING_NAMESPACE/);
  assert.match(patched, /gh:io\.crowline\.desktop:/);
  assert.match(patched, /return "gh:" \+ hostname/);
  assert.throws(() => patchGithubKeyring(patched), /anchor changed/);
  assert.throws(
    () => patchGithubKeyring(original + original),
    /anchor changed/,
  );
  assert.equal(isolatedGithubName("darwin"), "gh-isolated");
  assert.equal(isolatedGithubName("win32"), "gh-isolated.exe");
});
