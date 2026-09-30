import type { Provider } from "../domain";

const LOGOS: Record<Provider, string> = {
  github: "github",
  "github-deployments": "github",
  vercel: "vercel",
  aws: "aws",
  railway: "railway",
  netlify: "netlify",
  render: "render",
  "cloudflare-pages": "cloudflare",
  "cloudflare-workers": "cloudflare",
  heroku: "heroku",
  fly: "flydotio",
  gitlab: "gitlab",
  bitbucket: "bitbucket",
  digitalocean: "digitalocean",
  gcloud: "googlecloud",
  azure: "azure",
  eas: "expo",
  firebase: "firebase",
  supabase: "supabase",
  fastlane: "fastlane",
};

export function ProviderIcon({
  provider,
  size = 17,
}: {
  provider: Provider;
  size?: number;
}) {
  return (
    <img
      src={`/providers/${LOGOS[provider]}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{
        objectFit: "contain",
        flexShrink: 0,
        filter: "brightness(0) invert(1)",
      }}
    />
  );
}
