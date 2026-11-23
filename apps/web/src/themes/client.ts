import { sharedClient } from "../shared-content/client";
import { decodeThemeApproval, decodeThemeApprovals, decodeThemeConsumers, decodeThemeDiff, decodeThemeHistory, decodeThemeList, decodeThemeRevision, type ApprovalResult, type ThemeApprovals, type ThemeDiff, type ThemeHistory, type ThemeList, type ThemeRevision } from "./model";
import { decodeTheme, type ThemeDocument } from "./document";
import { decodeThemeRefusal, type ThemeRefusal } from "./refusal";

export type ThemeOutcome<T> = { status: "ok"; value: T } | ({ status: "refused" } & ThemeRefusal) | { status: "error"; message: string };
export type ReadTheme = ThemeRevision & { etag: string };
export type ThemeDraft = Omit<ThemeDocument, "api_version" | "id" | "owner">;
const client = sharedClient<ThemeDraft, ThemeRevision, ThemeList, ThemeHistory, ThemeApprovals, ReturnType<typeof decodeThemeConsumers>, ThemeDiff, ApprovalResult, ThemeRefusal>({
  segment: "themes", label: "thème", apiVersion: "board.theme/v1", document: decodeTheme, revision: decodeThemeRevision, owner: (value) => value.theme.owner,
  list: decodeThemeList, history: decodeThemeHistory, approvals: decodeThemeApprovals, consumers: decodeThemeConsumers,
  diff: decodeThemeDiff, approval: decodeThemeApproval, refusal: decodeThemeRefusal,
});
export const fetchThemes = client.list;
export const fetchTheme = client.read;
export const fetchThemeRevision = client.readRevision;
export const fetchThemeHistory = client.history;
export const fetchThemeApprovals = client.approvals;
export const fetchThemeConsumers = client.consumers;
export const createTheme = client.create;
export const reviseTheme = client.revise;
export const deleteTheme = client.remove;
export const fetchThemeDiff = client.diff;
export const approveTheme = client.approve;
