/** Assessment-only entry. Never included by the shipped application's entry. */
export * from '../support/libraryCloudBrowserEntry';
export {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry} from '../../apps/web/src/data/library/replication/libraryReplica';
export {sqliteRecordAdapter} from '../../apps/web/src/data/library/sqliteAdapter';
export {LibraryJourneyRepository} from '../../apps/web/src/experience/personalMeaningJourney/repository';
export {assertPersonalSemanticWorldState} from '../../apps/web/src/experience/personalMeaningJourney/authority';
