"use client";

import { Niivue } from "@niivue/niivue";
import { useCallback, useEffect, useRef, useState } from "react";

const SCAN_URL = "/scans/subject-0960-t1w.dcm";

function convertDicom(dicom: File): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/vendor/dcm2niix/worker.js", { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type?: string; message?: string; convertedFiles?: File[]; exitCode?: number }>) => {
      if (event.data.type === "ready") {
        worker.postMessage({
          fileList: [{ file: dicom, webkitRelativePath: dicom.name }],
          cmd: ["-b", "n", "-z", "y"],
        });
        return;
      }
      worker.terminate();
      if (event.data.type === "error") {
        reject(new Error(event.data.message ?? "DICOM conversion failed."));
      } else if (event.data.exitCode === 0 || event.data.exitCode === 3) {
        resolve(event.data.convertedFiles ?? []);
      } else {
        reject(new Error(`DICOM conversion failed with exit code ${event.data.exitCode ?? "unknown"}.`));
      }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("DICOM conversion worker could not start.")); };
  });
}

export default function BrainViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Niivue | null>(null);
  const [status, setStatus] = useState("Preparing 3D viewer…");
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [mode, setMode] = useState<"multiplanar" | "render">("multiplanar");

  useEffect(() => {
    let cancelled = false;
    async function initialise() {
      if (!canvasRef.current) return;
      try {
        const viewer = new Niivue({
          backColor: [0.03, 0.05, 0.09, 1], show3Dcrosshair: true, isResizeCanvas: true, isColorbar: false,
        });
        await viewer.attachToCanvas(canvasRef.current);
        viewer.setSliceType(viewer.sliceTypeMultiplanar);
        if (cancelled) return;
        viewerRef.current = viewer;
        setIsReady(true);
        setStatus("Viewer ready — load the structural T1 scan.");
      } catch (error) {
        setStatus(`Unable to start WebGL viewer: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    void initialise();
    return () => { cancelled = true; viewerRef.current = null; };
  }, []);

  const loadScan = useCallback(async () => {
    if (!viewerRef.current || isLoading) return;
    setIsLoading(true);
    setStatus("Reading the DICOM and reconstructing the 3D volume…");
    try {
      const response = await fetch(SCAN_URL);
      if (!response.ok) throw new Error(`Scan could not be read (${response.status}).`);
      const dicom = new File([await response.arrayBuffer()], "subject-0960-t1w.dcm", { type: "application/dicom" });
      const converted = await convertDicom(dicom);
      const nifti = converted.find((file) => /\.nii(\.gz)?$/i.test(file.name));
      if (!nifti) throw new Error("The DICOM converter did not produce a NIfTI volume.");
      await viewerRef.current.loadFromFile(nifti);
      viewerRef.current.setSliceType(viewerRef.current.sliceTypeMultiplanar);
      setStatus("Subject 0960 · T1-weighted anatomy loaded. Drag to pan/rotate; scroll to zoom.");
    } catch (error) {
      setStatus(`Couldn’t load the scan: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally { setIsLoading(false); }
  }, [isLoading]);

  const changeMode = (nextMode: "multiplanar" | "render") => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setSliceType(nextMode === "multiplanar" ? viewer.sliceTypeMultiplanar : viewer.sliceTypeRender);
    setMode(nextMode);
  };

  return <main className="viewer-shell">
    <header className="topbar"><div><p className="eyebrow">NEUROIMAGING LAB</p><h1>Subject 0960</h1></div><div className="study-label"><span className="status-dot" />Structural T1w · browser-only processing</div></header>
    <section className="workspace">
      <aside className="sidebar"><div><p className="panel-kicker">STUDY</p><h2>Brain MRI</h2><dl className="metadata"><div><dt>Series</dt><dd>34 · anat-T1w</dd></div><div><dt>Source</dt><dd>Enhanced DICOM</dd></div><div><dt>Size</dt><dd>38.6 MB</dd></div><div><dt>Display</dt><dd>WebGL 2</dd></div></dl></div><div className="sidebar-actions"><button className="primary-button" onClick={loadScan} disabled={!isReady || isLoading}>{isLoading ? "Reconstructing…" : "Load MRI"}</button><p>Conversion happens on this device. Nothing is uploaded for processing.</p></div></aside>
      <section className="viewer-panel" aria-label="Interactive brain MRI viewer"><div className="viewer-toolbar"><div className="mode-switch" aria-label="Viewer mode"><button className={mode === "multiplanar" ? "active" : ""} onClick={() => changeMode("multiplanar")}>Slices</button><button className={mode === "render" ? "active" : ""} onClick={() => changeMode("render")}>3D volume</button></div><span>{isLoading ? "Processing DICOM" : "Interactive"}</span></div><div className="canvas-frame"><canvas ref={canvasRef} className="brain-canvas" /><div className="scanline" aria-hidden="true" /></div><p className="viewer-status" role="status">{status}</p></section>
    </section>
  </main>;
}
