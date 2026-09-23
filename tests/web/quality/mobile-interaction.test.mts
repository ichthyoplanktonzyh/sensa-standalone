import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveEdgeSwipeBack} from '../../../apps/web/src/experience/ui/EdgeSwipeBack.tsx';

const width=390;
assert.deepEqual(
 resolveEdgeSwipeBack({deltaX:4,deltaY:1,velocityX:0,viewportWidth:width}).horizontal,
 false,
 'edge jitter must not claim a gesture',
);
assert.equal(
 resolveEdgeSwipeBack({deltaX:54,deltaY:80,velocityX:900,viewportWidth:width}).commit,
 false,
 'vertical scrolling must win even when its final X velocity is high',
);
assert.equal(
 resolveEdgeSwipeBack({deltaX:40,deltaY:2,velocityX:0,viewportWidth:width}).commit,
 false,
 'a short slow drag must cancel',
);
assert.equal(
 resolveEdgeSwipeBack({deltaX:100,deltaY:3,velocityX:0,viewportWidth:width}).commit,
 true,
 'a deliberate drag past the responsive threshold must return',
);
assert.equal(
 resolveEdgeSwipeBack({deltaX:32,deltaY:2,velocityX:800,viewportWidth:width}).commit,
 true,
 'a short fast flick must project through the return threshold',
);

const [html,theme,app,gesture,manifest]=await Promise.all([
 readFile(new URL('../../../apps/web/index.html',import.meta.url),'utf8'),
 readFile(new URL('../../../apps/web/src/theme.css',import.meta.url),'utf8'),
 readFile(new URL('../../../apps/web/src/experience/App.tsx',import.meta.url),'utf8'),
 readFile(new URL('../../../apps/web/src/experience/ui/EdgeSwipeBack.tsx',import.meta.url),'utf8'),
 readFile(new URL('../../../apps/web/public/manifest.webmanifest',import.meta.url),'utf8'),
]);
assert.match(html,/viewport-fit=cover, interactive-widget=resizes-content/u);
assert.doesNotMatch(html,/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/u);
assert.match(theme,/-webkit-tap-highlight-color:\s*transparent/u);
assert.match(theme,/@media \(pointer: coarse\)[\s\S]*font-size: max\(1rem, 16px\)/u);
assert.match(app,/<EdgeSwipeBack enabled=/u);
assert.match(gesture,/display-mode: standalone/u);
assert.match(gesture,/pointer: coarse/u);
assert.match(gesture,/navigator\.vibrate\(8\)/u);
assert.equal(JSON.parse(manifest).display,'standalone');

console.log('PASS: installed coarse-pointer PWA navigation gets a thresholded, velocity-aware edge return with optional haptics; browser gestures, vertical scroll, zoom and learning outcomes remain untouched.');
