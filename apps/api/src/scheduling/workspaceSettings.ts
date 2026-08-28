import type { DatabaseExecutor } from "../database/index.js";
import {
  defaultWorkspaceSchedulerConfig,
  type WorkspaceSchedulerConfig,
} from "@sensa/learning-kernel";

export type { WorkspaceSchedulerConfig } from "@sensa/learning-kernel";

/**
 * The standalone extraction keeps scheduler settings behind this seam.  The
 * first local vertical slice uses the production defaults; a dedicated settings
 * surface can be added without coupling scheduler configuration to encounter
 * or Sync projection storage.
 */
export async function getWorkspaceSchedulerConfig(
  _executor: DatabaseExecutor,
  _workspaceId: string,
): Promise<WorkspaceSchedulerConfig> {
  return defaultWorkspaceSchedulerConfig;
}
