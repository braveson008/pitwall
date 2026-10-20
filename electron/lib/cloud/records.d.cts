export interface CloudRecord {
  kind: string;
  localId: string;
  data: Record<string, any>;
}
export declare const RENDERER_KINDS: Set<string>;
export declare function outcomeId(outcome: { projectId: string; provider: string; model: string; at: string }): string;
export declare function recordsFromSnapshot(snapshot: unknown): CloudRecord[];
declare const records: { RENDERER_KINDS: typeof RENDERER_KINDS; outcomeId: typeof outcomeId; recordsFromSnapshot: typeof recordsFromSnapshot };
export default records;
