import { Cloud, GitBranch, Triangle } from "lucide-react";
import type { Provider } from "../domain";
export function ProviderIcon({
  provider,
  size = 17,
}: {
  provider: Provider;
  size?: number;
}) {
  const Icon =
    provider === "github"
      ? GitBranch
      : provider === "vercel"
        ? Triangle
        : Cloud;
  return (
    <Icon
      size={size}
      aria-hidden="true"
      fill={provider === "vercel" ? "currentColor" : "none"}
    />
  );
}
