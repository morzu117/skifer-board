import { sharedClient } from "../shared-content/client";
import { decodeComponentApproval, decodeComponentApprovals, decodeComponentConsumers, decodeComponentDiff, decodeComponentHistory, decodeComponentList, decodeComponentRevision, type ApprovalResult, type ComponentApprovals, type ComponentDiff, type ComponentHistory, type ComponentList, type ComponentRevision } from "./model";
import { decodeComponent, type ComponentDocument } from "./document";
import { decodeComponentRefusal, type ComponentRefusal } from "./refusal";

export type ComponentOutcome<T> = { status: "ok"; value: T } | ({ status: "refused" } & ComponentRefusal) | { status: "error"; message: string };
export type ReadComponent = ComponentRevision & { etag: string };
export type ComponentDraft = Omit<ComponentDocument, "api_version" | "id" | "owner">;
const client = sharedClient<ComponentDraft, ComponentRevision, ComponentList, ComponentHistory, ComponentApprovals, ReturnType<typeof decodeComponentConsumers>, ComponentDiff, ApprovalResult, ComponentRefusal>({
  segment: "components", label: "composant", apiVersion: "board.component/v1", document: decodeComponent, revision: decodeComponentRevision, owner: (value) => value.component.owner,
  list: decodeComponentList, history: decodeComponentHistory, approvals: decodeComponentApprovals, consumers: decodeComponentConsumers,
  diff: decodeComponentDiff, approval: decodeComponentApproval, refusal: decodeComponentRefusal,
});
export const fetchComponents = client.list;
export const fetchComponent = client.read;
export const fetchComponentRevision = client.readRevision;
export const fetchComponentHistory = client.history;
export const fetchComponentApprovals = client.approvals;
export const fetchComponentConsumers = client.consumers;
export const createComponent = client.create;
export const reviseComponent = client.revise;
export const deleteComponent = client.remove;
export const fetchComponentDiff = client.diff;
export const approveComponent = client.approve;
