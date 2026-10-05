import {
  assertLearningSystemTransition,
  LearningSystemInvariantError,
  learningTransitionTables,
} from './learningAuthority';
import {
  command,
  type LibraryIdentity,
  type LibraryTransaction,
  type Operation,
} from './store';
import {hasStudyScopeCaptureWitness} from './studyScopes';

/** Storage adapter for the Learning System authority's local transition seam. */
export async function admitLearningSystemTransaction(
  tx:LibraryTransaction,
  operation:Operation,
):Promise<void>{
  const changes=await tx.proposedChanges(learningTransitionTables);
  const relevant=changes.filter(change=>(
    ['curriculumEnrollments','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations'].includes(change.table)
    ||change.table==='meta'&&['learning-active','learning-session-active'].includes(change.key)
    ||change.table==='settings'&&change.key==='language-route-study-plans'
  ));
  if(!relevant.length)return;
  const identity=await tx.get<LibraryIdentity>('meta','identity');
  if(!identity)throw new LearningSystemInvariantError('The local Learning System has no Library identity.');
  await assertLearningSystemTransition({
    identity,
    operation,
    changes:relevant,
    read:(table,key)=>tx.get(table,key),
    scopeMember:(scopeId,targetId)=>tx.studyScopeMember(scopeId,targetId),
    capturedScopeIds:relevant.filter(change=>change.table==='studyScopes'&&hasStudyScopeCaptureWitness(tx,change.key)).map(change=>change.key),
  });
}

/** Run one local command and admit its complete Learning fact transition before commit. */
export function learningCommand<T>(
  operation:Operation,
  work:(tx:LibraryTransaction)=>Promise<T>,
):Promise<T>{
  return command(operation,async tx=>{
    const result=await work(tx);
    await admitLearningSystemTransaction(tx,operation);
    return result;
  });
}
