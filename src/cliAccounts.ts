import { z } from "zod";
export const githubProviderSchema = z.enum(["github", "github-deployments"]);
export type GithubProvider = z.infer<typeof githubProviderSchema>;
export const isGithubProvider = (value: string): value is GithubProvider =>
  value === "github" || value === "github-deployments";
export const githubUsernameSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/)
  .refine((username) => !username.includes("--"));
export const githubCliBindingSchema = z.object({
  provider: githubProviderSchema,
  connectionId: z.string().min(1).max(128),
  username: githubUsernameSchema,
});
