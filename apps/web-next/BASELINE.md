# Candidate Frontend Baseline

> Active stage workflow: [`FRONTEND_FIRST_WORKFLOW.md`](FRONTEND_FIRST_WORKFLOW.md)

This directory began as a byte-for-byte candidate frontend baseline imported from:

`/Users/shadow/Desktop/不背/learn-flow`

Import date: 2026-08-28

## Baseline status

This copy is the frozen IA, visual, layout, animation, gesture, and existing
interaction reference for the Sensa frontend discussion. Its purpose is to
let us confirm pages one by one and then derive the API requirements from the
confirmed frontend needs.

The copied baseline files were initially unchanged. During the active
frontend-first workflow, modify only the journey or page currently being
confirmed, and preserve already accepted CSS, layout, animation, gestures and
interactions unless the user reopens that decision. Keep this app separate
from the current production frontend while that review is in progress.

This app is intentionally not registered in the repository root workspace.
It is an independent candidate frontend and must keep its own dependencies
and lockfile for now.

## Runtime presentation vocabulary

The imported prototype originally contained `sensa` and `baseline` presentation
switches for the learning lifecycle. The learning lifecycle `baseline`
comparison has been removed — high-assurance initial and review now always use
the current Sensa/compact implementation and no longer expose Reveal,
Recognition, Recall, Transfer, Example or Review `baseline` switches. Outside
the learning lifecycle, `baseline` comparisons remain intentionally (Semantic
World, Academy/free practice, Portable Listening, YouGlish/real-world
listening, Dictionary/QuickDict).

In this stage `sensa` and `baseline` do not mean two equivalent themes:

- `sensa` is the candidate UI/runtime family for Sensa's high-assurance
  Structured Learning Policy;
- `baseline` outside learning is the earlier Bubei-style reproduction kept only
  as a comparison reference;
- the `lightweight` Learning Policy is a separate Sensa runtime and must
  not be identified with `baseline`.

Future formal routing follows the Committed Learning Policy. A comparison
switch may remain in non-learning prototype tooling, but it cannot redefine
Protocol, Gate, Evidence or Graduation semantics. The Side Panel no longer
offers learning baseline switches, and the explanatory “可检查的学习状态”
section has been removed.

## Imported files

The import includes the source project's `.gitignore`, `index.html`,
`package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`,
`test_words.ts`, and `src/**` files.

The following were excluded from the import:

- `node_modules/`
- `dist/`
- `.DS_Store`
- logs, caches, environment files, and other generated/runtime artifacts

The `node_modules/` and `dist/` directories may be generated locally by
validation commands because they are ignored by this app; they are not part
of the imported baseline.
