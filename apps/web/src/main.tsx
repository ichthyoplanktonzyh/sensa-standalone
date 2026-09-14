import "./schemaRuntime";
import "./i18n";
import "./browserSmokeBridge";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./experience/router/router";
import "./theme.css";
import './experience/components/examples/learningExample.css';

createRoot(document.getElementById("root")!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
if(import.meta.env.PROD&&'serviceWorker' in navigator){
 const status=(value:string)=>{document.documentElement.dataset.offlineShell=value;window.dispatchEvent(new Event('sensa-offline-shell'));};
 status('preparing');
 void navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>status('ready')).catch(()=>status('failed'));
}
