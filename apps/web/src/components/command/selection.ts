/** What the context panel shows and which map marker is highlighted. One at a time (Design.md §1). */
export type Selection =
  | { kind: "camera"; id: string }
  | { kind: "detection"; id: string }
  | { kind: "incident"; id: string }
  | { kind: "station"; id: string };

export const selectionKey = (s: Selection | null) => (s ? `${s.kind}:${s.id}` : "");
