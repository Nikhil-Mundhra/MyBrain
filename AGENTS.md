# MyBrain contributor guide

## Repository overview

This repository keeps two independent brain-imaging workflows together:

- `mri-visualizer/` is a Next.js 16 application that displays the bundled
  structural MRI scan in the browser. It is deployed to Vercel with
  `mri-visualizer` configured as the project's Root Directory.
- `brain-3d-print/` is a reference workflow for turning a structural T1 scan
  into a printable STL brain model using FreeSurfer, FSL, and MeshLab. It is
  primarily documentation, a shell script, a MeshLab smoothing preset, and
  illustrative images; it is not part of the web application's build.

Treat these as separate projects. Do not add Node/Next.js assumptions to the
printing workflow or neuroimaging-system dependencies to the web app.

## Working in `mri-visualizer/`

`mri-visualizer/AGENTS.md` applies to every change below that directory. In
particular, consult the version-matched Next.js documentation in
`mri-visualizer/node_modules/next/dist/docs/` before changing Next.js code.

The application uses the App Router:

- `src/app/page.tsx` is deliberately thin and renders `BrainViewer`.
- `src/components/brain-viewer.tsx` is a client component. It owns Niivue's
  browser-only/WebGL lifecycle, DICOM-to-NIfTI conversion through the bundled
  worker, MRI loading, display mode, palette, and the display-only analytics
  panels.
- `src/app/globals.css` contains the interface styling.
- `public/scans/subject-0960-t1w.dcm` is the scan the viewer fetches at
  runtime. `public/vendor/dcm2niix/` contains the static conversion worker and
  WASM assets it requires; keep their paths aligned with the URLs in
  `brain-viewer.tsx`.
- `vercel.json` supplies the Vercel build command and security headers.

From `mri-visualizer/`, use:

```bash
npm ci
npm run dev
npm run lint
npm run build
```

Run lint for code changes and build when changing application behavior,
dependencies, or deployment configuration. Keep `package-lock.json` in sync
with intentional dependency changes.

The UI labels its signal and tissue summaries as illustrative previews. Preserve
that distinction: the viewer is not a diagnostic or clinical-analysis tool.
Keep browser APIs, Web Workers, and Niivue access inside client components and
their lifecycle hooks; do not move them into server-rendered modules.

## Working in `brain-3d-print/`

Read `brain-3d-print/README.md` before modifying the pipeline. The executable
entry point is `script/3Dprinting_brain.sh`; it expects:

1. A subject folder containing `input/struct.nii` or `input/struct.nii.gz`.
2. FreeSurfer, FSL, and MeshLab/`meshlabserver` installed on the host.
3. A main directory containing `smoothing.mlx` (the repository copy is in
   `script/smoothing.mlx`; callers may need to place it alongside their input
   workspace).

The pipeline can run for hours and produces large, potentially sensitive MRI
derivatives and STL files. Do not execute it against real data without the
user's explicit request. Do not commit patient/source scans, derived subject
directories, or generated models unless the user has expressly approved the
specific files.

## Repository conventions

- Keep generated artifacts, `.next/`, dependency directories, Vercel state,
  environment files, and `.DS_Store` out of commits. Remove accidental
  `.DS_Store` additions rather than treating them as source files.
- `brain-3d-print/subject-0960/` is ignored because it may hold sensitive MRI
  data and derived print artifacts. Apply the same privacy standard to any
  new subject data.
- Prefer focused changes in the relevant subproject. A root-level change should
  normally describe both workflows, as this guide and `README.md` do.
