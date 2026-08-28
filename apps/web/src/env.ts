import { z } from "zod";

const webEnvironmentSchema = z.object({
  VITE_SENSA_API_URL: z.string().url().optional(),
  VITE_SENSA_REPLICA_ID: z.string().uuid().optional(),
}).strip();

const parsedEnvironment = webEnvironmentSchema.safeParse(import.meta.env);
if (!parsedEnvironment.success) {
  throw new Error("Sensa Web 环境配置无效，请检查 VITE_SENSA_API_URL 与 VITE_SENSA_REPLICA_ID。");
}

export const sensaWebEnv = parsedEnvironment.data;
