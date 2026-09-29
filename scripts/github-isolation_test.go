// Regression coverage copied into the checksum-pinned upstream gh config package.
// The keyring is mocked: these tests never access the user's credential store.
package config

import (
	"testing"

	"github.com/cli/cli/v2/internal/keyring"
	ghConfig "github.com/cli/go-gh/v2/pkg/config"
	"github.com/stretchr/testify/require"
)

func TestCrowlineKeyringIsolation(t *testing.T) {
	local, _ := NewIsolatedTestConfig(t)
	a := &AuthConfig{cfg: ghConfig.ReadFromString("")}
	b := &AuthConfig{cfg: ghConfig.ReadFromString("")}
	global := &AuthConfig{cfg: local.cfg}
	use := func(namespace string, auth *AuthConfig) {
		t.Setenv("CROWLINE_GH_KEYRING_NAMESPACE", namespace)
		ghConfig.Read = func(_ *ghConfig.Config) (*ghConfig.Config, error) { return auth.cfg, nil }
	}
	login := func(auth *AuthConfig, user, token string) {
		_, err := auth.Login("github.com", user, token, "https", true)
		require.NoError(t, err)
	}
	use("", global)
	login(global, "alex", "synthetic-local")
	use("github:slot-b", b)
	login(b, "sam", "synthetic-b")
	use("github:slot-a", a)
	// A fresh account must not fall back to the local or another slot's token.
	token, _ := a.ActiveToken("github.com")
	require.Empty(t, token)
	login(a, "alex", "synthetic-a")
	token, _ = a.ActiveToken("github.com")
	require.Equal(t, "synthetic-a", token)
	login(a, "robin", "synthetic-a-second")
	require.NoError(t, a.SwitchUser("github.com", "alex"))
	require.NoError(t, a.Logout("github.com", "robin"))
	require.NoError(t, a.Logout("github.com", "alex"))
	_, err := a.TokenFromKeyring("github.com")
	require.Error(t, err)
	use("github:slot-b", b)
	token, _ = b.ActiveToken("github.com")
	require.Equal(t, "synthetic-b", token)
	use("", global)
	token, _ = global.ActiveToken("github.com")
	require.Equal(t, "synthetic-local", token)
	// Local gh continues using the exact original service name.
	token, err = keyring.Get("gh:github.com", "")
	require.NoError(t, err)
	require.Equal(t, "synthetic-local", token)
}
