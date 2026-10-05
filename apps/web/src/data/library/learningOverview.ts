import {readLibrary} from './store';
import {readStudyPlans} from './studyPlans';
import type {LocalLearningTarget,LocalLearningRun} from '../../learning/runtime/localProtocol';
import type {LocalCurriculumEnrollment} from './curriculumEnrollments';

/** Complete management snapshot under one read lease. Importing this read
 * module never loads Curriculum admission or Run mutation machinery. */
export const readLearningOverview=()=>readLibrary(async tx=>({
 targets:await tx.all<LocalLearningTarget>('learningTargets'),
 enrollments:await tx.all<LocalCurriculumEnrollment>('curriculumEnrollments'),
 runs:await tx.all<LocalLearningRun>('learningRuns'),
 active:await tx.get<string>('meta','learning-active'),
 studyPlans:await readStudyPlans(tx),
}));
