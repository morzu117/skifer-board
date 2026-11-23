import { sharedClient } from "../shared-content/client";
import { decodePageTemplateApprovals, decodePageTemplateConsumers, decodePageTemplateHistory, decodePageTemplateList, decodePageTemplateRevision, type PageTemplateApprovals, type PageTemplateHistory, type PageTemplateList, type PageTemplateRevision } from "./model";
import { decodePageTemplate, type PageTemplate } from "./document";
import { decodePageTemplateApproval, decodePageTemplateDiff, type ApprovalResult, type PageTemplateDiff } from "./diff";
import { decodePageTemplateRefusal, type PageTemplateRefusal } from "./refusal";

export type PageTemplateOutcome<T> = { status: "ok"; value: T } | ({ status: "refused" } & PageTemplateRefusal) | { status: "error"; message: string };
export type ReadPageTemplate = PageTemplateRevision & { etag: string };
export type PageTemplateDraft = Omit<PageTemplate, "api_version" | "id" | "owner">;
const client = sharedClient<PageTemplateDraft, PageTemplateRevision, PageTemplateList, PageTemplateHistory, PageTemplateApprovals, ReturnType<typeof decodePageTemplateConsumers>, PageTemplateDiff, ApprovalResult, PageTemplateRefusal>({
  segment: "page-templates", label: "modèle de page", apiVersion: "board.page_template/v1", document: decodePageTemplate, revision: decodePageTemplateRevision, owner: (value) => value.pageTemplate.owner,
  list: decodePageTemplateList, history: decodePageTemplateHistory, approvals: decodePageTemplateApprovals, consumers: decodePageTemplateConsumers,
  diff: decodePageTemplateDiff, approval: decodePageTemplateApproval, refusal: decodePageTemplateRefusal,
});
export const fetchPageTemplates = client.list;
export const fetchPageTemplate = client.read;
export const fetchPageTemplateRevision = client.readRevision;
export const fetchPageTemplateHistory = client.history;
export const fetchPageTemplateApprovals = client.approvals;
export const fetchPageTemplateConsumers = client.consumers;
export const createPageTemplate = client.create;
export const revisePageTemplate = client.revise;
export const deletePageTemplate = client.remove;
export const fetchPageTemplateDiff = client.diff;
export const approvePageTemplate = client.approve;
