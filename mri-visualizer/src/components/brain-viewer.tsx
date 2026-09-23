"use client";

import { Niivue } from "@niivue/niivue";
import { useCallback, useEffect, useRef, useState } from "react";

const SCAN_URL = "/scans/subject-0960-t1w.dcm";
const DISPLAY_PRESETS = [
  { id: "gray", label: "Anatomy", map: "gray", accent: [0.2, 0.9, 1, 0.75], detail: "Neutral structural contrast" },
  { id: "hot", label: "Thermal", map: "hot", accent: [1, 0.32, 0.56, 0.78], detail: "High-intensity emphasis" },
  { id: "viridis", label: "Spectrum", map: "viridis", accent: [0.65, 0.9, 0.2, 0.78], detail: "Perceptual color scale" },
] as const;
type PresetId = (typeof DISPLAY_PRESETS)[number]["id"];

function convertDicom(dicom: File): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/vendor/dcm2niix/worker.js", { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type?: string; message?: string; convertedFiles?: File[]; exitCode?: number }>) => {
      if (event.data.type === "ready") { worker.postMessage({ fileList: [{ file: dicom, webkitRelativePath: dicom.name }], cmd: ["-b", "n", "-z", "y"] }); return; }
      worker.terminate();
      if (event.data.type === "error") reject(new Error(event.data.message ?? "DICOM conversion failed."));
      else if (event.data.exitCode === 0 || event.data.exitCode === 3) resolve(event.data.convertedFiles ?? []);
      else reject(new Error(`DICOM conversion failed with exit code ${event.data.exitCode ?? "unknown"}.`));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("DICOM conversion worker could not start.")); };
  });
}

function SignalProfile() {
  return <svg className="signal-chart" viewBox="0 0 250 112" role="img" aria-label="Example relative signal-intensity distribution"><defs><linearGradient id="signalFill" x1="0" x2="1"><stop stopColor="#28d7ff" stopOpacity=".44" /><stop offset=".55" stopColor="#bcf34b" stopOpacity=".34" /><stop offset="1" stopColor="#ff5f8e" stopOpacity=".2" /></linearGradient></defs><path className="chart-grid" d="M10 91H242M10 64H242M10 37H242M10 10H242" /><path className="chart-area" d="M10 91 C25 91 30 84 42 70 S63 31 79 22 S102 35 115 56 S133 78 148 72 S167 37 182 42 S199 79 215 83 S231 89 242 91 V91 Z" /><path className="chart-line" d="M10 91 C25 91 30 84 42 70 S63 31 79 22 S102 35 115 56 S133 78 148 72 S167 37 182 42 S199 79 215 83 S231 89 242 91" /><text x="10" y="108">LOW</text><text x="208" y="108">HIGH</text></svg>;
}

function TissueBreakdown({ preset }: { preset: PresetId }) {
  return <div className={`tissue-bars ${preset}`} aria-label="Illustrative tissue mix">{[["CSF", "14%", "14", "csf"], ["Gray matter", "41%", "41", "gray-matter"], ["White matter", "45%", "45", "white-matter"]].map(([label, value, width, color]) => <div key={label}><span><i className={`swatch ${color}`} />{label}</span><b>{value}</b><em style={{ width: `${width}%` }} /></div>)}</div>;
}

export default function BrainViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Niivue | null>(null);
  const [status, setStatus] = useState("Preparing visual workspace…");
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [mode, setMode] = useState<"multiplanar" | "render">("multiplanar");
  const [preset, setPreset] = useState<PresetId>("gray");

  useEffect(() => {
    let cancelled = false;
    async function initialise() {
      if (!canvasRef.current) return;
      try {
        const viewer = new Niivue({ backColor: [0.015, 0.025, 0.05, 1], show3Dcrosshair: true, isResizeCanvas: true, isColorbar: false });
        await viewer.attachToCanvas(canvasRef.current); viewer.setSliceType(viewer.sliceTypeMultiplanar); viewer.setCrosshairColor([...DISPLAY_PRESETS[0].accent]);
        if (cancelled) return;
        viewerRef.current = viewer; setIsReady(true); setStatus("Viewer ready · load the structural T1 scan.");
      } catch (error) { setStatus(`Unable to start WebGL viewer: ${error instanceof Error ? error.message : "unknown error"}`); }
    }
    void initialise();
    return () => { cancelled = true; viewerRef.current = null; };
  }, []);

  const applyPreset = useCallback((nextPreset: PresetId) => {
    const viewer = viewerRef.current; const next = DISPLAY_PRESETS.find((item) => item.id === nextPreset);
    if (!viewer || !next) return;
    setPreset(nextPreset); viewer.setCrosshairColor([...next.accent]);
    if (viewer.volumes[0]) viewer.setColormap(viewer.volumes[0].id, next.map);
    setStatus(`${next.label} palette active · ${next.detail.toLowerCase()}.`);
  }, []);
  const loadScan = useCallback(async () => {
    if (!viewerRef.current || isLoading) return;
    setIsLoading(true); setStatus("Reading DICOM and reconstructing 3D volume…");
    try {
      const response = await fetch(SCAN_URL); if (!response.ok) throw new Error(`Scan could not be read (${response.status}).`);
      const dicom = new File([await response.arrayBuffer()], "subject-0960-t1w.dcm", { type: "application/dicom" });
      const nifti = (await convertDicom(dicom)).find((file) => /\.nii(\.gz)?$/i.test(file.name));
      if (!nifti) throw new Error("The DICOM converter did not produce a NIfTI volume.");
      await viewerRef.current.loadFromFile(nifti); viewerRef.current.setSliceType(viewerRef.current.sliceTypeMultiplanar); setIsLoaded(true); applyPreset(preset); setStatus("Subject 0960 loaded · inspect linked slices or switch to a 3D volume.");
    } catch (error) { setStatus(`Couldn’t load the scan: ${error instanceof Error ? error.message : "unknown error"}`); }
    finally { setIsLoading(false); }
  }, [applyPreset, isLoading, preset]);
  const changeMode = (nextMode: "multiplanar" | "render") => { const viewer = viewerRef.current; if (!viewer) return; viewer.setSliceType(nextMode === "multiplanar" ? viewer.sliceTypeMultiplanar : viewer.sliceTypeRender); setMode(nextMode); };

  return <main className="viewer-shell"><header className="topbar"><div><p className="eyebrow">NEUROVISUALIZATION STUDIO</p><h1>Subject <span>0960</span></h1></div><div className="study-label"><span className="status-dot" />Structural T1w <b>·</b> Local processing</div></header><section className="workspace"><aside className="sidebar control-panel"><div><p className="panel-kicker">Study overview</p><h2>Brain MRI</h2><dl className="metadata"><div><dt>Series</dt><dd>34 · anat-T1w</dd></div><div><dt>Source</dt><dd>Enhanced DICOM</dd></div><div><dt>Resolution</dt><dd>1.0 mm isotropic</dd></div><div><dt>Display</dt><dd>WebGL 2</dd></div></dl></div><div className="palette-control"><p className="panel-kicker">Display palette</p>{DISPLAY_PRESETS.map((item) => <button key={item.id} className={`palette-option ${preset === item.id ? "selected" : ""}`} onClick={() => applyPreset(item.id)} aria-pressed={preset === item.id}><i className={item.id} /><span>{item.label}<small>{item.detail}</small></span></button>)}</div><div className="sidebar-actions"><button className="primary-button" onClick={loadScan} disabled={!isReady || isLoading}>{isLoading ? "Reconstructing…" : isLoaded ? "Reload MRI" : "Load MRI"}</button><p>Palettes change display only. They do not create clinical findings.</p></div></aside><section className="viewer-panel" aria-label="Interactive brain MRI viewer"><div className="viewer-toolbar"><div className="mode-switch" aria-label="Viewer mode"><button className={mode === "multiplanar" ? "active" : ""} onClick={() => changeMode("multiplanar")}>Linked slices</button><button className={mode === "render" ? "active" : ""} onClick={() => changeMode("render")}>3D volume</button></div><div className="viewer-readout"><span className="live-dot" />{isLoading ? "Processing" : isLoaded ? "Live volume" : "Awaiting scan"}</div></div><div className="canvas-frame"><canvas ref={canvasRef} className="brain-canvas" /><div className="scanline" aria-hidden="true" /><div className="orientation-label orientation-top">Superior</div><div className="orientation-label orientation-left">Left</div><div className="orientation-label orientation-right">Right</div></div><p className="viewer-status" role="status">{status}</p></section><aside className="analytics-panel" aria-label="Scan visual summary"><div className="analytics-heading"><p className="panel-kicker">Visual readout</p><span>Preview</span></div><section className="analysis-card"><div className="card-heading"><h3>Signal profile</h3><span>Relative</span></div><SignalProfile /><p>Display-only intensity distribution</p></section><section className="analysis-card"><div className="card-heading"><h3>Tissue mix</h3><span>Preview</span></div><TissueBreakdown preset={preset} /><p>Example segmentation proportions</p></section><section className="legend-card"><p className="panel-kicker">Color guide</p><div><i className="legend-dot cyan" />Structural detail</div><div><i className="legend-dot lime" />Intensity range</div><div><i className="legend-dot pink" />High signal emphasis</div></section></aside></section></main>;
}
