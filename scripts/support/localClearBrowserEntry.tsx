import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../apps/web/src/i18n/workspaceResources';
import {LocalDataControlPanel} from '../../apps/web/src/experience/components/LocalDataControlPanel';

export function mountLocalDataControl(){
 document.body.innerHTML='<main id="local-clear-fixture"></main>';
 createRoot(document.getElementById('local-clear-fixture')!).render(
  <LocalDataControlPanel synchronize={()=>((window as any).sync as ()=>Promise<void>)()}/>,
 );
}
