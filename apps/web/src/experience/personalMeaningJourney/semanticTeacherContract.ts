import { z } from 'zod';
import type { SemanticAgentTurnInput, SemanticAgentWorkingSet } from './semanticAgent';
import type { MeaningLookupMatch } from './meaningLookup';
import { newUuid } from './ids';

const text = z.string().trim().min(1).max(4000);
const expressionType = z.enum(['word', 'phrase', 'construction', 'sentence', 'utterance_strategy']);

/** The model submits a compact candidate; the host supplies route-owned fields. */
export const organizeAnswerSchema = z.object({
  context: text,
  sense: text,
  scene: text.optional(),
  expression: text,
  expressionType,
  reason: text,
  changeReason: text.optional(),
}).strict();

const reusedAnswerSchema=organizeAnswerSchema.omit({sense:true,scene:true}).extend({
  reuseSense:z.object({senseId:z.uuid(),senseVersionId:z.uuid()}).strict(),
}).strict();

export const replyToLearnerSchema = z.object({ text }).strict();
export type OrganizedAnswer = z.infer<typeof organizeAnswerSchema> & {reuseSense?:z.infer<typeof reusedAnswerSchema>['reuseSense']};

/** Reply is visible; clarity and candidate stay private until the final result validates. */
const teacherTurnSchema = z.object({
  reply: text,
  clarity: z.object({context:z.boolean(),sense:z.boolean(),expression:z.boolean()}).strict(),
  proposal: z.union([organizeAnswerSchema,reusedAnswerSchema]).nullable(),
}).strict();

export const teacherTurnJsonSchema=z.toJSONSchema(teacherTurnSchema);

/** Correction feedback names rejected fields and rules, never learner/model values. */
export function teacherCorrectionFeedback(cause:unknown):string{
  if(cause instanceof z.ZodError){
    return JSON.stringify(cause.issues.slice(0,8).map(issue=>({
      code:issue.code,
      path:issue.path.map(part=>typeof part==='number'?part:String(part).replace(/[^A-Za-z0-9_]/gu,'').slice(0,64)),
      ...('keys' in issue?{unexpectedKeys:issue.keys.slice(0,8).map(key=>key.replace(/[^A-Za-z0-9_]/gu,'').slice(0,64))}:{}),
    })));
  }
  return cause instanceof Error&&/^teacher_[a-z_]+$/u.test(cause.message)?cause.message:'invalid_json';
}

export function parseTeacherTurn(raw:unknown,input:SemanticAgentTurnInput,lookedUp:readonly MeaningLookupMatch[]=[]){
  const result=teacherTurnSchema.parse(raw);
  const complete=result.clarity.context&&result.clarity.sense&&result.clarity.expression;
  if(complete!==(result.proposal!==null))throw new Error('teacher_inconsistent_clarity');
  const selection=result.proposal&&'reuseSense' in result.proposal?result.proposal.reuseSense:undefined;
  const reused=selection?lookedUp.find(item=>item.senseId===selection.senseId&&item.senseVersionId===selection.senseVersionId):undefined;
  if(selection&&!reused)throw new Error('teacher_invalid_reuse_reference');
  let proposal:OrganizedAnswer|null=null;
  if(result.proposal){
    // Reuse is a selection, not a model-authored rewrite of an existing contract.
    // Registry key/meaning lengths need not fit new-candidate text constraints.
    if(reused&&selection){
      const {reuseSense:_selection,...fields}=reusedAnswerSchema.parse(result.proposal);
      const edited=input.learnerEditedTracks;
      if((edited.includes('context')&&input.workingSet.context?.summary!==fields.context)
        ||(edited.includes('sense')&&input.workingSet.sense?.coreMeaningFocus!==reused.semanticSpec.coreMeaningFocus)
        ||(edited.includes('expression')&&(input.workingSet.expression?.surfaceForm!==fields.expression
          ||input.workingSet.expression?.expressionType!==fields.expressionType)))throw new Error('teacher_learner_edit_changed');
      const familiar=input.material.familiarExpression?.trim();
      if(familiar&&normalize(familiar)!==normalize(fields.expression)&&!fields.changeReason)throw new Error('teacher_expression_changed_silently');
      proposal={...fields,reuseSense:selection,sense:reused.semanticSpec.coreMeaningFocus};
    }else proposal=parseOrganizedAnswer(result.proposal,input);
  }
  const reply=parseLearnerReply({text:result.reply},proposal,input.material.familiarExpression);
  return {reply,proposal,reused};
}

/** Decode only a first top-level reply string, never another field or raw JSON. */
export function teacherReplyPrefix(raw:string):string|null{
  const start=/^\s*\{\s*"reply"\s*:\s*"/u.exec(raw);
  if(!start)return null;
  let value='';
  for(let at=start[0].length;at<raw.length;at++){
    const char=raw[at]!;
    if(char==='"')break;
    if(char==='\\'){
      const escape=raw[++at];
      if(escape===undefined)break;
      if(escape==='u'){
        const hex=raw.slice(at+1,at+5);
        if(!/^[0-9a-f]{4}$/iu.test(hex))break;
        value+=String.fromCharCode(Number.parseInt(hex,16));at+=4;
      }else{
        const decoded:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
        if(!(escape in decoded))break;
        value+=decoded[escape];
      }
    }else{
      if(char.charCodeAt(0)<32)break;
      value+=char;
    }
  }
  const last=value.charCodeAt(value.length-1);
  return last>=0xd800&&last<=0xdbff?value.slice(0,-1):value;
}

const normalize = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();

/** Reject changes to explicit learner edits and silent replacement of a familiar expression. */
export function parseOrganizedAnswer(raw: unknown, input: SemanticAgentTurnInput): OrganizedAnswer {
  const answer = organizeAnswerSchema.parse(raw);
  const edited = input.learnerEditedTracks;
  if ((edited.includes('context') && input.workingSet.context?.summary !== answer.context)
    || (edited.includes('sense') && input.workingSet.sense?.coreMeaningFocus !== answer.sense)
    || (edited.includes('expression') && (
      input.workingSet.expression?.surfaceForm !== answer.expression
      || input.workingSet.expression?.expressionType !== answer.expressionType
    ))) throw new Error('teacher_learner_edit_changed');
  const familiar = input.material.familiarExpression?.trim();
  if (familiar && normalize(familiar) !== normalize(answer.expression) && !answer.changeReason) {
    throw new Error('teacher_expression_changed_silently');
  }
  return answer;
}

/** Only source-grounded candidate fields become a reviewable working set. */
export function workingSetForAnswer(answer: OrganizedAnswer, input: SemanticAgentTurnInput, reused?:MeaningLookupMatch): SemanticAgentWorkingSet {
  if(answer.reuseSense&&!reused)throw new Error('teacher_invalid_reuse_reference');
  const expression = {
    surfaceForm: answer.expression,
    expressionType: answer.expressionType,
    languageTag: input.languages.targetLanguageTag,
    relation: null,
    semanticCoverage: null,
    rationale: answer.reason,
  };
  return {
    context: { summary: answer.context, salientDetails: [], unresolvedDetails: [], rationale: answer.reason },
    focus: input.workingSet.focus,
    sense: {
      proposedSenseKey: reused?.senseKey ?? `personal-${newUuid()}`,
      ...(reused?{reuseSense:{senseId:reused.senseId,senseVersionId:reused.senseVersionId}}:{}),
      ...(reused?structuredClone({
        coreMeaningFocus:reused.semanticSpec.coreMeaningFocus,prototypeScenes:reused.semanticSpec.prototypeScenes,
        includedCases:reused.semanticSpec.includedCases,excludedCases:reused.semanticSpec.excludedCases,
        neighborContrasts:reused.semanticSpec.neighborContrasts,openQuestions:reused.semanticSpec.openQuestions,
      }):{
        coreMeaningFocus: answer.sense,
        prototypeScenes: answer.scene ? [{ summary: answer.scene, participantRoles: [], states: [], directionOrCausality: null }] : [],
        includedCases: [], excludedCases: [], neighborContrasts: [], openQuestions: [],
      }),
      unresolvedQuestions: [],
      rationale: answer.reason,
    },
    expression,
    expressions: [expression],
  };
}

/** The visible reply must actually announce the staged expression and explain replacements. */
export function parseLearnerReply(raw: unknown, answer: OrganizedAnswer | null, familiarExpression: string | null): string {
  const reply = replyToLearnerSchema.parse(raw).text;
  if (answer && !normalize(reply).includes(normalize(answer.expression))) {
    throw new Error('teacher_reply_omits_expression');
  }
  const familiar = familiarExpression?.trim();
  if (answer && familiar && normalize(familiar) !== normalize(answer.expression)
    && !normalize(reply).includes(normalize(familiar))) {
    throw new Error('teacher_reply_omits_familiar_expression');
  }
  return reply;
}
