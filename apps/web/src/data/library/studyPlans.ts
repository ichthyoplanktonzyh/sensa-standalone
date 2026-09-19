import type {LibraryTransaction} from './store';

export type LocalStudyPlan={
 languageRouteId:string;
 routeRevision:number;
 revision:number;
 dailyNewSenseLimit:number;
 updatedAt:string;
};

const STUDY_PLANS_KEY='language-route-study-plans';

export const readStudyPlans=async(tx:LibraryTransaction):Promise<Record<string,LocalStudyPlan>>=>
 await tx.get('settings',STUDY_PLANS_KEY)??{};

export const writeStudyPlans=(tx:LibraryTransaction,plans:Readonly<Record<string,LocalStudyPlan>>):void=>{
 tx.put('settings',STUDY_PLANS_KEY,plans);
};
