import {useEffect,useState} from 'react';
/** Browser connectivity is only a prerequisite signal, never proof that an
 * external media, account or model service is healthy. */
export function useBrowserOnline(){
 const [online,setOnline]=useState(()=>navigator.onLine);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 return online;
}
