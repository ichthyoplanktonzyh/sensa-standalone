import { queryWithUserScope } from "../database/index.js";
import { HttpError } from "../shared/errors.js";

type WorkspaceMembershipRow = Readonly<{ workspace_id: string }>;

export async function assertUserHasWorkspaceAccess(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const result = await queryWithUserScope<WorkspaceMembershipRow>(
    { userId },
    "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1 AND workspace_id = $2",
    [userId, workspaceId],
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }
}
