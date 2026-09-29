import {createContext,useContext} from 'react';
import type {LibraryAvailability} from './AccountLibrarySync';

export type AccountAccess={
 deleteAccount:()=>void;
 notice:string;
 email:string|null;
 onlineService:boolean;
 publisherAccess:boolean;
 connectionConflict:boolean;
 libraryAvailability:LibraryAvailability;
 login:()=>void;
 logout:()=>Promise<void>;
};

export const AccountContext=createContext<AccountAccess>({
 deleteAccount:()=>{},
 notice:'',
 email:null,
 onlineService:false,
 publisherAccess:false,
 connectionConflict:false,
 libraryAvailability:'restoring',
 login:()=>{},
 logout:async()=>{},
});

export const useAccountExperience=()=>useContext(AccountContext);
