import "./schemaRuntime";
import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./experience/router/router";
import { initializeAppearance } from "./experience/appearance/store";
import { RootRecoveryBoundary } from "./application/ProductRecovery";
import { createBrowserReliability } from "./observability/browserReliability";
import "./theme.css";
import './experience/components/examples/learningExample.css';

initializeAppearance();
if (import.meta.env.VITE_SENSA_BROWSER_SMOKE === 'true') void import('./browserSmokeBridge');
declare const __SENSA_RELEASE__: string;
const reliability = createBrowserReliability({
  endpoint: import.meta.env.VITE_SENSA_API_URL,
  release: __SENSA_RELEASE__,
  metricSampled: import.meta.env.VITE_SENSA_BROWSER_SMOKE === 'true' ? false : undefined,
});
reliability.start();
const root = createRoot(document.getElementById("root")!, {
  onCaughtError: (error, info) => reliability.reportReactError("react_caught", error, info.componentStack),
  onUncaughtError: (error, info) => reliability.reportReactError("react_uncaught", error, info.componentStack),
  onRecoverableError: (error, info) => reliability.reportReactError("react_recoverable", error, info.componentStack),
});
const skinLabRequested = import.meta.env.DEV && new URLSearchParams(window.location.search).get("skin-lab") === "1";

if (skinLabRequested) {
  void import("./experience/appearance/SkinSurfaceGallery").then(({ SkinSurfaceGallery }) => {
    root.render(<StrictMode><RootRecoveryBoundary><SkinSurfaceGallery /></RootRecoveryBoundary></StrictMode>);
  });
} else {
  root.render(<StrictMode><RootRecoveryBoundary><RouterProvider router={router} /></RootRecoveryBoundary></StrictMode>);
}
if(import.meta.env.PROD&&'serviceWorker' in navigator){
 const status=(value:string)=>{document.documentElement.dataset.offlineShell=value;window.dispatchEvent(new Event('sensa-offline-shell'));};
 status('preparing');
 void navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>status('ready')).catch(()=>status('failed'));
}
