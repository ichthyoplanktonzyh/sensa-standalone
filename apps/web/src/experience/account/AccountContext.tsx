import {createContext,useContext} from 'react';
import type {LibraryAvailability} from './AccountLibrarySync';

export type AccountAccess={
 deleteAccount:()=>void;
 notice:string;
 email:string|null;
 onlineService:boolean;
 webSessionPresent:boolean;
 publisherAccess:boolean;
 connectionConflict:boolean;
 libraryAvailability:LibraryAvailability;
 connectionBusy:boolean;
 checkConnection:()=>void;
 login:()=>void;
 retryConnection:()=>Promise<void>;
 logout:()=>Promise<void>;
};

export const AccountContext=createContext<AccountAccess>({
 deleteAccount:()=>{},
 notice:'',
 email:null,
 onlineService:false,
 webSessionPresent:false,
 publisherAccess:false,
 connectionConflict:false,
 libraryAvailability:'restoring',
 connectionBusy:false,
 checkConnection:()=>{},
 login:()=>{},
 retryConnection:async()=>{},
 logout:async()=>{},
});

export const useAccountExperience=()=>useContext(AccountContext);
