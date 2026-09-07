import assert from "node:assert/strict";
import {
  presentScreen,
  foregroundScreen,
  restoreSiblingInteraction,
} from "../apps/web/src/experience/ui/screenInteraction";
import { buildMeaningGraph } from "../apps/web/src/experience/ui/meaningGraph";
import {
  buildPathname,
  parseMainStack,
  retainParamsForStack,
} from "../apps/web/src/experience/router/shellLocation";
import type { JourneyWorldItemView } from "../apps/web/src/experience/personalMeaningJourney";

function screen() {
  const attrs = new Map<string, string>();
  const styles = new Map<string, string>();
  const node = {
    inert: true,
    classList: { contains: (name: string) => name === "screen" },
    getAttribute: (name: string) => attrs.get(name),
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    style: {
      setProperty: (name: string, value: string) => styles.set(name, value),
    },
  } as unknown as HTMLElement;
  return { node, styles };
}
const content = screen(),
  entry = screen(),
  library = screen();
presentScreen(content.node, true, false);
presentScreen(entry.node, false, false);
const oldEntryInert = entry.node.inert;
// Route changes while Add content closes. The dialog's old snapshot must not
// disable the newly foreground entry page.
presentScreen(content.node, false, false);
presentScreen(entry.node, true, false);
restoreSiblingInteraction(entry.node, oldEntryInert);
assert.equal(
  entry.node.inert,
  false,
  "existing-content back button remains interactive",
);
assert.equal(
  content.styles.get("pointer-events"),
  "none",
  "background cannot cover entry",
);
assert.equal(entry.styles.get("z-index"), "100");
for (const section of ["saved-senses", "saved-examples", "notes"]) {
  const path = buildPathname(["s-content", "s-content-library"]);
  const stack = parseMainStack(path).slice(0, -1);
  assert.deepEqual(stack, ["s-content"]);
  assert.deepEqual(retainParamsForStack({ section }, stack), {});
  presentScreen(library.node, false, false);
  presentScreen(content.node, true, false);
  restoreSiblingInteraction(library.node, false);
  assert.equal(
    library.styles.get("visibility"),
    "hidden",
    "departing list cannot flash default recent records",
  );
  assert.equal(library.node.inert, true);
}
assert.deepEqual(
  parseMainStack(buildPathname(["s-content", "s-learning-entry"])).slice(0, -1),
  ["s-content"],
);

const item = {
  personalMeaningId: "m1",
  primaryLabel: "A real context",
  experienceAnchors: [],
  familiarAnchors: [],
  detail: {
    focuses: [
      {
        meaningFocusId: "f1",
        statement: "One focus",
        proposal: {},
        alignment: null,
      },
    ],
    directAlignments: [],
  },
} as unknown as JourneyWorldItemView;
let graph = buildMeaningGraph([item]);
assert.deepEqual(graph.nodes.map((n) => n.kind).sort(), [
  "context",
  "focus",
  "proposal",
]);
assert.equal(
  graph.nodes.some((n) => n.kind === "expression"),
  false,
  "proposals never fabricate confirmed expressions",
);
const alignment = {
  personalMeaningAlignmentId: "a1",
  coreMeaningFocus: "Confirmed meaning",
  confirmedBindings: [{ bindingVersionId: "b1", surfaceForm: "an expression" }],
};
const direct = {
  ...item,
  detail: { focuses: [], directAlignments: [alignment] },
} as unknown as JourneyWorldItemView;
graph = buildMeaningGraph([direct]);
assert.deepEqual(graph.nodes.map((n) => n.kind).sort(), [
  "context",
  "expression",
  "sense",
]);
assert.equal(
  graph.nodes.find((n) => n.kind === "sense")?.focusId,
  "a1",
  "direct alignment opens its exact detail",
);
for (const edge of graph.edges) {
  assert.ok(graph.nodes.some((n) => n.id === edge.from));
  assert.ok(graph.nodes.some((n) => n.id === edge.to));
}
assert.equal(new Set(graph.nodes.map((n) => n.id)).size, graph.nodes.length);
console.log(
  "Content navigation regression passed: modal/route interaction, three collection returns, existing-content return, graph proposal and direct-alignment edges.",
);

const foregroundNode=(id:string,active:boolean,layer:number=0)=>({
  id,classList:{contains:(name:string)=>name==='active'?active:name==='screen'},
  getAttribute:(name:string)=>name==='data-screen-layer'?String(layer):null,
}) as unknown as HTMLElement;
const home=foregroundNode('s-home',true);
const learning=foregroundNode('s-learn',true);
const dictionary=foregroundNode('s-reference-dictionary',true,1);
const examples=foregroundNode('s-reference-example',true,2);
const zIndex=(node:HTMLElement)=>node===learning?40:node===dictionary?38:0;
assert.equal(foregroundScreen([home,learning,dictionary],'s-home',true,zIndex),dictionary,'dictionary opens above learning even with a lower CSS z-index');
assert.equal(foregroundScreen([home,dictionary],'s-home',false,zIndex),dictionary,'dictionary also opens from a main page');
assert.equal(foregroundScreen([home,learning,dictionary,examples],'s-home',true,zIndex),examples,'dictionary examples sit above dictionary');
assert.equal(foregroundScreen([home,learning,dictionary],'s-home',true,zIndex),dictionary,'closing examples returns to dictionary');
assert.equal(foregroundScreen([home,learning],'s-home',true,zIndex),learning,'closing dictionary returns to learning');
console.log('Dictionary foreground regression passed: home, runtime, nested examples and back.');
