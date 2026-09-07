import type { JourneyWorldItemView } from "../personalMeaningJourney";

export interface MeaningGraphNode {
  id: string;
  kind: "context" | "focus" | "proposal" | "sense" | "expression";
  label: string;
  meaningId: string;
  focusId?: string;
  confirmed: boolean;
  x: number;
  y: number;
}
export interface MeaningGraphEdge {
  from: string;
  to: string;
}

/** Layout follows explicit context/focus/alignment/binding facts only. */
export function buildMeaningGraph(items: readonly JourneyWorldItemView[]) {
  const nodes: MeaningGraphNode[] = [];
  const edges: MeaningGraphEdge[] = [];
  let cursor = 50;
  for (const item of items) {
    const rootId = `context:${item.personalMeaningId}`;
    const branches = [
      ...item.detail.focuses.map((f) => ({
        id: f.meaningFocusId,
        label: f.statement,
        alignment: f.alignment,
        proposal: f.proposal,
        direct: false,
      })),
      ...item.detail.directAlignments.map((a) => ({
        id: a.personalMeaningAlignmentId,
        label: a.coreMeaningFocus,
        alignment: a,
        proposal: null,
        direct: true,
      })),
    ];
    const start = cursor;
    for (const branch of branches) {
      const bindings = branch.alignment?.confirmedBindings ?? [];
      const height = Math.max(90, bindings.length * 80);
      const y = cursor + height / 2;
      const focusId = `focus:${item.personalMeaningId}:${branch.id}`;
      const senseId = `sense:${item.personalMeaningId}:${branch.id}`;
      const base = {
        meaningId: item.personalMeaningId,
        focusId: branch.id,
        confirmed: !!branch.alignment,
      };
      if (!branch.direct) {
        nodes.push({
          ...base,
          id: focusId,
          kind: "focus",
          label: branch.label,
          x: 310,
          y,
        });
        edges.push({ from: rootId, to: focusId });
      }
      if (branch.alignment || branch.proposal) {
        nodes.push({
          ...base,
          id: senseId,
          kind: branch.alignment ? "sense" : "proposal",
          label: branch.alignment?.coreMeaningFocus || branch.label,
          x: 600,
          y,
        });
        edges.push({ from: branch.direct ? rootId : focusId, to: senseId });
        bindings.forEach((binding, index) => {
          const id = `expression:${item.personalMeaningId}:${branch.id}:${binding.bindingVersionId}`;
          nodes.push({
            ...base,
            id,
            kind: "expression",
            label: binding.surfaceForm,
            x: 890,
            y: cursor + 45 + index * 80,
          });
          edges.push({ from: senseId, to: id });
        });
      }
      cursor += height + 30;
    }
    if (!branches.length) cursor += 120;
    nodes.push({
      id: rootId,
      kind: "context",
      label:
        item.experienceAnchors[0]?.surfaceForm ||
        item.familiarAnchors[0]?.surfaceForm ||
        item.primaryLabel,
      meaningId: item.personalMeaningId,
      confirmed: false,
      x: 20,
      y: (start + cursor - 30) / 2,
    });
    cursor += 70;
  }
  return { nodes, edges, width: 1160, height: Math.max(400, cursor) };
}
