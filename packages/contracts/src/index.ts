export type LearnerScope = Readonly<{
  workspaceId: string;
  learnerUserId: string;
}>;

export type ReplicaScope = LearnerScope &
  Readonly<{
    replicaId: string;
  }>;

export type SensaApiIdentity = Readonly<{
  name: "sensa-standalone";
  version: string;
  contractVersion: "sensa-api-v1";
  learningModel: "sense-first-semantic-learning-loop";
}>;

export const learnerScope = (scope: LearnerScope): LearnerScope => {
  if (scope.workspaceId.trim() === "" || scope.learnerUserId.trim() === "") {
    throw new Error("LearnerScope requires workspaceId and learnerUserId");
  }
  return Object.freeze({
    workspaceId: scope.workspaceId,
    learnerUserId: scope.learnerUserId,
  });
};
