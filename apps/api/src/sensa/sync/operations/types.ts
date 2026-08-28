import type {
  SensaSyncOperationResultPayload,
  SensaSyncV2OperationResultPayload,
} from "@sensa/contracts/sensa";
import type { FeedEntity, FeedFact } from "../feeds.js";

export type OperationExecution = Readonly<{
  payload: SensaSyncOperationResultPayload;
  entities: ReadonlyArray<FeedEntity>;
  facts: ReadonlyArray<FeedFact>;
  rebased: boolean;
}>;

export type V2OperationExecution = Readonly<{
  payload: SensaSyncV2OperationResultPayload;
  entities: ReadonlyArray<FeedEntity>;
  facts: ReadonlyArray<FeedFact>;
  rebased: boolean;
}>;
