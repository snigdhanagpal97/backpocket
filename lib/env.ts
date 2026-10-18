import { z } from "zod";

const digitsList = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(",")
      .map((phone) => phone.replace(/\D/g, ""))
      .filter(Boolean),
  )
  .refine((phones) => phones.length > 0, "needs at least one phone number");

export const envSchema = z.object({
  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  ALLOWED_PHONES: digitsList,
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // Keep only the origin, so a pasted ".../rest/v1/" still works.
  SUPABASE_URL: z.url().transform((value) => new URL(value).origin),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => {
        const name = issue.path.join(".");
        return source[name] ? `${name} (${issue.message})` : `${name} (missing)`;
      })
      .join(", ");
    throw new Error(
      `Invalid environment variables: ${problems}. Check .env.local or your Vercel project settings.`,
    );
  }
  return result.data;
}

let cached: Env | undefined;

// Validated lazily on first use so `next build` works without secrets present.
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
