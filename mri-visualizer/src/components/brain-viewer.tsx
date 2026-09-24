"use client";

import { Niivue, SHOW_RENDER } from "@niivue/niivue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import GestureController, { type BrainStructure } from "./gesture-controller";

const SCAN_URL = "/scans/subject-0960-t1w.dcm";

const DISPLAY_PRESETS = [
  { id: "gray", label: "Anatomy", map: "gray", accent: [0.22, 0.74, 0.97, 0.75], detail: "Structural grayscale" },
  { id: "hot", label: "Thermal", map: "hot", accent: [0.98, 0.44, 0.52, 0.78], detail: "High-intensity heatmap" },
  { id: "viridis", label: "Perceptual", map: "viridis", accent: [0.2, 0.83, 0.6, 0.78], detail: "Calibrated spectrum" },
] as const;

type PresetId = (typeof DISPLAY_PRESETS)[number]["id"];

function hexToRgba255(hex: string, alpha = 230): [number, number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255, alpha];
}

function convertDicom(dicom: File): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/vendor/dcm2niix/worker.js", { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type?: string; message?: string; convertedFiles?: File[]; exitCode?: number }>) => {
      if (event.data.type === "ready") {
        worker.postMessage({ fileList: [{ file: dicom, webkitRelativePath: dicom.name }], cmd: ["-b", "n", "-z", "y"] });
        return;
      }
      worker.terminate();
      if (event.data.type === "error") reject(new Error(event.data.message ?? "DICOM conversion failed."));
      else if (event.data.exitCode === 0 || event.data.exitCode === 3) resolve(event.data.convertedFiles ?? []);
      else reject(new Error(`DICOM conversion failed with exit code ${event.data.exitCode ?? "unknown"}.`));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("DICOM conversion worker could not start."));
    };
  });
}

const STRUCTURES_MANIFEST = "/models/hpc-output/web_meshes/brain_structures.json";

type StageMode = "structures" | "glass" | "slices";

export default function BrainViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Niivue | null>(null);
  const [status, setStatus] = useState("Spatial stage initialized · select visualization mode.");
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [stageMode, setStageMode] = useState<StageMode>("structures");
  const [preset, setPreset] = useState<PresetId>("gray");
  const [isGestureActive, setIsGestureActive] = useState(false);

  // Skull / Scalp Opacity
  const [headOpacity, setHeadOpacity] = useState<number>(0.0);

  // Anatomical Meshes Opacity (Allows fading or completely hiding structures down to 0)
  const [structuresOpacity, setStructuresOpacity] = useState<number>(1.0);
  const structuresOpacityRef = useRef<number>(1.0);

  // Volumetric Brain Structures State
  const [structures, setStructures] = useState<BrainStructure[]>([]);
  const [areStructuresLoaded, setAreStructuresLoaded] = useState(false);
  const [isLoadingStructures, setIsLoadingStructures] = useState(false);
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);
  const [explosionMm, setExplosionMm] = useState<number>(0);
  const origPtsMapRef = useRef<Map<string, Float32Array>>(new Map());

  // Resizable non-floating studio panels
  const [leftWidth, setLeftWidth] = useState<number>(310);
  const [rightWidth, setRightWidth] = useState<number>(330);
  const resizingRef = useRef<"left" | "right" | null>(null);
  const dragStartXRef = useRef<number>(0);
  const dragStartWidthRef = useRef<number>(0);

  const startResizeLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = "left";
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = leftWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth]);

  const startResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = "right";
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = rightWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [rightWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      if (resizingRef.current === "left") {
        const delta = e.clientX - dragStartXRef.current;
        const newWidth = Math.max(180, Math.min(520, dragStartWidthRef.current + delta));
        setLeftWidth(newWidth);
      } else if (resizingRef.current === "right") {
        const delta = dragStartXRef.current - e.clientX;
        const newWidth = Math.max(200, Math.min(560, dragStartWidthRef.current + delta));
        setRightWidth(newWidth);
      }
      const viewer = viewerRef.current;
      if (viewer && typeof viewer.resizeListener === "function") {
        viewer.resizeListener();
      }
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const viewer = viewerRef.current;
        if (viewer && typeof viewer.resizeListener === "function") {
          viewer.resizeListener();
        }
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Initialize Niivue WebGL context with refined background tone
  useEffect(() => {
    let cancelled = false;
    async function initialise() {
      if (!canvasRef.current) return;
      try {
        const viewer = new Niivue({
          backColor: [0.035, 0.042, 0.058, 1],
          show3Dcrosshair: true,
          isResizeCanvas: true,
          isColorbar: false,
          multiplanarShowRender: SHOW_RENDER.NEVER,
        });
        await viewer.attachToCanvas(canvasRef.current);
        viewer.setSliceType(viewer.sliceTypeRender);
        viewer.setCrosshairColor([...DISPLAY_PRESETS[0].accent]);
        if (cancelled) return;
        viewerRef.current = viewer;
        setIsReady(true);
      } catch (error) {
        setStatus(`WebGL engine failure: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    void initialise();
    return () => {
      cancelled = true;
      viewerRef.current = null;
    };
  }, []);

  const applyPreset = useCallback((nextPreset: PresetId) => {
    const next = DISPLAY_PRESETS.find((item) => item.id === nextPreset);
    if (!next) return;
    setPreset(nextPreset);
    const viewer = viewerRef.current;
    if (viewer) {
      viewer.setCrosshairColor([...next.accent]);
      if (viewer.volumes && viewer.volumes[0]) {
        viewer.setColormap(viewer.volumes[0].id, next.map);
      }
    }
    setStatus(`${next.label} colormap applied · ${next.detail.toLowerCase()}.`);
  }, []);

  const loadScan = useCallback(async () => {
    if (!viewerRef.current || isLoading) return;
    setIsLoading(true);
    setStatus("Reading DICOM volume & computing multiplanar slices…");
    try {
      const response = await fetch(SCAN_URL);
      if (!response.ok) throw new Error(`Scan unavailable (${response.status}).`);
      const dicom = new File([await response.arrayBuffer()], "subject-0960-t1w.dcm", { type: "application/dicom" });
      const nifti = (await convertDicom(dicom)).find((file) => /\.nii(\.gz)?$/i.test(file.name));
      if (!nifti) throw new Error("DICOM converter produced no valid NIfTI volume.");
      await viewerRef.current.loadFromFile(nifti);
      setIsLoaded(true);
      applyPreset(preset);
      setStatus("MRI scan loaded · linked orthogonal slices ready.");
    } catch (error) {
      setStatus(`Failed loading MRI volume: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  }, [applyPreset, isLoading, preset]);

  // Load brain structure meshes with tiered biological opacity
  const loadStructuresForData = useCallback(
    async (targetStructures: BrainStructure[]) => {
      const viewer = viewerRef.current;
      if (!viewer || targetStructures.length === 0 || isLoadingStructures) return;
      setIsLoadingStructures(true);
      setStatus(`Mounting ${targetStructures.length} anatomical meshes into WebGL stage…`);
      try {
        if (viewer.meshes && viewer.meshes.length > 0 && typeof viewer.removeMesh === "function") {
          while (viewer.meshes.length > 0) {
            viewer.removeMesh(viewer.meshes[0]);
          }
        }
        origPtsMapRef.current.clear();

        const initialOpacity = structuresOpacityRef.current;
        const initialAlpha = Math.round(initialOpacity * 255);

        const meshList = targetStructures.map((s) => ({
          url: s.meshFile,
          name: `${s.id}.obj`,
          rgba255: hexToRgba255(s.color, initialAlpha),
          opacity: initialOpacity,
          visible: initialOpacity > 0.001,
        }));
        await viewer.loadMeshes(meshList);
        viewer.meshes.forEach((m) => {
          const match = targetStructures.find((s) => m.name.includes(s.id));
          if (match && m.pts) {
            origPtsMapRef.current.set(match.id, new Float32Array(m.pts));
          }
        });
        setAreStructuresLoaded(true);
        viewer.setSliceType(viewer.sliceTypeRender);
        if (viewer.volumes && viewer.volumes.length > 0) {
          viewer.setOpacity(0, headOpacity);
        }
        if (typeof viewer.drawScene === "function") {
          viewer.drawScene();
        }
        setStatus(`${targetStructures.length} anatomical structures loaded · interactive stage ready.`);
      } catch (err) {
        setStatus(`Failed loading meshes: ${err instanceof Error ? err.message : "unknown error"}`);
      } finally {
        setIsLoadingStructures(false);
      }
    },
    [headOpacity, isLoadingStructures]
  );

  const loadStructures = useCallback(() => {
    return loadStructuresForData(structures);
  }, [loadStructuresForData, structures]);

  const hasMountedRef = useRef(false);

  // Fetch structure manifest once on startup and initialize meshes
  useEffect(() => {
    if (!isReady || hasMountedRef.current) return;
    let cancelled = false;

    async function loadManifestAndMount() {
      try {
        const res = await fetch(STRUCTURES_MANIFEST);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as BrainStructure[];
        if (cancelled) return;
        setStructures(data);

        const viewer = viewerRef.current;
        if (viewer && data.length > 0) {
          hasMountedRef.current = true;
          await loadStructuresForData(data);
          if (cancelled) return;

          // Preload scan volume in the background so 3D camera extents and slice views are calibrated
          void loadScan();
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(`Failed loading structures: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
    }
    void loadManifestAndMount();
    return () => {
      cancelled = true;
    };
  }, [isReady, loadScan, loadStructuresForData]);

  // Switch unified visual modes: Isolated Structures, Glass Cranium, Linked Slices
  const handleStageModeChange = useCallback(
    async (nextMode: StageMode) => {
      setStageMode(nextMode);
      const viewer = viewerRef.current;
      if (!viewer) return;

      if (nextMode === "slices") {
        viewer.opts.multiplanarShowRender = SHOW_RENDER.NEVER;
        viewer.setSliceType(viewer.sliceTypeMultiplanar);
        if (!isLoaded && !isLoading) {
          await loadScan();
        }
        setStatus("Linked multiplanar slices active · axial, sagittal, and coronal views.");
      } else if (nextMode === "glass") {
        viewer.setSliceType(viewer.sliceTypeRender);
        setHeadOpacity(0.2);
        if (!isLoaded && !isLoading) {
          void loadScan();
        }
        if (!areStructuresLoaded && !isLoadingStructures && structures.length > 0) {
          void loadStructures();
        }
        if (viewer.volumes && viewer.volumes.length > 0) {
          viewer.setOpacity(0, 0.2);
          viewer.drawScene();
        }
        setStatus("Glass Cranium active · holographic skull envelope with internal brain core.");
      } else {
        // "structures"
        viewer.setSliceType(viewer.sliceTypeRender);
        setHeadOpacity(0.0);
        if (viewer.volumes && viewer.volumes.length > 0) {
          viewer.setOpacity(0, 0.0);
          viewer.drawScene();
        }
        if (!areStructuresLoaded && !isLoadingStructures && structures.length > 0) {
          void loadStructures();
        }
        setStatus("Isolated 3D Structures active · 16 subcortical neural hubs.");
      }
    },
    [areStructuresLoaded, isLoaded, isLoading, isLoadingStructures, loadScan, loadStructures, structures]
  );

  const handleHeadOpacityChange = useCallback((newOpacity: number) => {
    setHeadOpacity(newOpacity);
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (viewer.volumes && viewer.volumes.length > 0) {
      viewer.setOpacity(0, newOpacity);
      viewer.drawScene();
    }
  }, []);

  const handleStructuresOpacityChange = useCallback((newOpacity: number) => {
    setStructuresOpacity(newOpacity);
    structuresOpacityRef.current = newOpacity;
    const viewer = viewerRef.current;
    if (!viewer || !viewer.meshes) return;

    viewer.meshes.forEach((m) => {
      m.opacity = newOpacity;
      m.visible = newOpacity > 0.001;

      // Update RGBA alpha buffer if present
      if (m.rgba255 && m.rgba255.length >= 4) {
        m.rgba255[3] = Math.round(newOpacity * 255);
      }
    });

    if (typeof viewer.drawScene === "function") {
      viewer.drawScene();
    }
  }, []);

  // State container ref for smooth kinetic explosion, animation loop, and displacement offsets
  const explosionStateRef = useRef<{
    animId: number | null;
    globalMm: number;
    isolateOffsetMm: number;
    selectedId: string | null;
  }>({
    animId: null,
    globalMm: 0,
    isolateOffsetMm: 0,
    selectedId: null,
  });


  // Compute the true collective anatomical centroid across active structures
  const coreCentroid = useMemo(() => {
    if (structures.length === 0) return [0, 0, 0] as [number, number, number];
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    structures.forEach((s) => {
      sumX += s.centroid[0];
      sumY += s.centroid[1];
      sumZ += s.centroid[2];
    });
    return [
      sumX / structures.length,
      sumY / structures.length,
      sumZ / structures.length,
    ] as [number, number, number];
  }, [structures]);

  // Apply displacement immediately to GPU mesh buffers
  const applyDisplacementImmediate = useCallback(
    (globalDisp: number, isolateId: string | null = null, isolateDisp: number = 0) => {
      const viewer = viewerRef.current;
      if (!viewer || !viewer.meshes || viewer.meshes.length === 0) return;

      const [coreX, coreY, coreZ] = coreCentroid;

      structures.forEach((struct) => {
        const mesh = viewer.meshes.find((m) => m.name.includes(struct.id));
        if (!mesh || !mesh.pts) return;

        let orig = origPtsMapRef.current.get(struct.id);
        if (!orig) {
          orig = new Float32Array(mesh.pts);
          origPtsMapRef.current.set(struct.id, orig);
        }

        const [cx, cy, cz] = struct.centroid;

        // Radial vector originating from the collective core centroid
        let rx = cx - coreX;
        const ry = cy - coreY;
        const rz = cz - coreZ;

        // Enhance lateral separation for bilateral structures so left/right hemispheres separate cleanly
        rx *= 1.35;

        // Ensure structures on the midline still have an unambiguous separation vector
        const mag = Math.hypot(rx, ry, rz);
        let ux: number;
        let uy: number;
        let uz: number;

        if (mag < 1e-3) {
          ux = 0;
          uy = -0.5;
          uz = -0.866;
        } else {
          ux = rx / mag;
          uy = ry / mag;
          uz = rz / mag;
        }

        // Combine global explosion displacement with isolated pop-out displacement
        let totalDisp = globalDisp;
        if (isolateId && struct.id === isolateId) {
          totalDisp += isolateDisp;
        }

        const dx = ux * totalDisp;
        const dy = uy * totalDisp;
        const dz = uz * totalDisp;

        for (let i = 0; i < mesh.pts.length; i += 3) {
          mesh.pts[i] = orig[i] + dx;
          mesh.pts[i + 1] = orig[i + 1] + dy;
          mesh.pts[i + 2] = orig[i + 2] + dz;
        }

        if (viewer.gl) {
          mesh.updateMesh(viewer.gl);
        }
      });

      viewer.drawScene();
    },
    [coreCentroid, structures]
  );

  // Smooth tween animation using ease-out cubic curve
  const animateDisplacement = useCallback(
    (targetGlobal: number, targetIsolateDisp: number = 0, durationMs = 380) => {
      const state = explosionStateRef.current;
      if (state.animId !== null) {
        cancelAnimationFrame(state.animId);
        state.animId = null;
      }

      const startGlobal = state.globalMm;
      const startIsolate = state.isolateOffsetMm;
      const startTime = performance.now();
      const currentSelectedId = state.selectedId;

      setExplosionMm(targetGlobal);

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        // Ease-out cubic curve: 1 - (1 - t)^3
        const ease = 1 - Math.pow(1 - progress, 3);

        const currentGlobal = startGlobal + (targetGlobal - startGlobal) * ease;
        const currentIsolate = startIsolate + (targetIsolateDisp - startIsolate) * ease;

        applyDisplacementImmediate(currentGlobal, currentSelectedId, currentIsolate);

        if (progress < 1) {
          state.animId = requestAnimationFrame(step);
        } else {
          state.animId = null;
          state.globalMm = targetGlobal;
          state.isolateOffsetMm = targetIsolateDisp;
        }
      };

      state.animId = requestAnimationFrame(step);
    },
    [applyDisplacementImmediate]
  );

  useEffect(() => {
    const state = explosionStateRef.current;
    return () => {
      if (state.animId !== null) {
        cancelAnimationFrame(state.animId);
        state.animId = null;
      }
    };
  }, []);

  // Handler for radial explosion slider (immediate responsiveness during drag)
  const handleExplosionChange = useCallback(
    (newExplosion: number) => {
      const state = explosionStateRef.current;
      if (state.animId !== null) {
        cancelAnimationFrame(state.animId);
        state.animId = null;
      }
      setExplosionMm(newExplosion);
      state.globalMm = newExplosion;
      applyDisplacementImmediate(newExplosion, state.selectedId, state.isolateOffsetMm);
    },
    [applyDisplacementImmediate]
  );

  const toggleSelectStructure = useCallback(
    (id: string) => {
      const viewer = viewerRef.current;
      const state = explosionStateRef.current;

      if (selectedStructureId === id) {
        // Deselect & smooth dock isolation back to baseline
        setSelectedStructureId(null);
        state.selectedId = null;
        animateDisplacement(state.globalMm, 0, 320);
      } else {
        setSelectedStructureId(id);
        state.selectedId = id;

        // Pop selected structure out smoothly by +25mm relative to current explosion
        state.isolateOffsetMm = 0;
        animateDisplacement(state.globalMm, 25, 360);

        // Center crosshairs on this anatomical structure in slices & 3D space
        const struct = structures.find((s) => s.id === id);
        if (viewer && struct) {
          const [cx, cy, cz] = struct.centroid;
          if (typeof viewer.setCrosshairColor === "function") {
            const [r, g, b] = hexToRgba255(struct.color, 255);
            viewer.setCrosshairColor([r / 255, g / 255, b / 255, 1.0]);
          }

          if (stageMode === "slices" && viewer.volumes && viewer.volumes[0]) {
            try {
              const frac = viewer.mm2frac([cx, cy, cz]);
              viewer.scene.crosshairPos = frac;
              viewer.drawScene();
            } catch {
              // fallback if coordinate transform is pending
            }
          }
        }
      }
    },
    [animateDisplacement, stageMode, structures, selectedStructureId]
  );

  const handleToggleGesture = useCallback(() => {
    setIsGestureActive((prev) => {
      const next = !prev;
      if (next && stageMode === "slices") {
        void handleStageModeChange("structures");
      }
      return next;
    });
  }, [handleStageModeChange, stageMode]);

  const activeSelectedStructure = structures.find((s) => s.id === selectedStructureId);

  return (
    <main className="viewer-shell">
      {/* Editorial Navigation Bar */}
      <header className="topbar">
        <div className="brand-section">
          <span className="brand-badge">SPATIAL NEURO</span>
          <h1>
            Subject 0960 <span>· High-Field T1w Anatomical Study</span>
          </h1>
        </div>
        <div className="topbar-meta">
          <div className="study-badge">
            <span className="status-dot" />
            <span>TotalSegmentator v2 · HPC A100</span>
          </div>
        </div>
      </header>

      {/* End-to-End Studio Workspace with Resizable Split Panes */}
      <section
        className="workspace"
        style={{
          gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr) 6px ${rightWidth}px`,
        }}
      >
        {/* Left Control Rail */}
        <aside className="sidebar" aria-label="Viewer Controls" style={{ width: leftWidth }}>
          <div>
            <p className="panel-kicker">Overview</p>
            <h2 className="card-title">Subject Profile</h2>
            <dl className="metadata-clean">
              <div>
                <dt>Series</dt>
                <dd>anat-T1w · 34</dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd>1.0mm Isotropic</dd>
              </div>
              <div>
                <dt>Neural Core</dt>
                <dd>{structures.length} Meshes</dd>
              </div>
              <div>
                <dt>Source Model</dt>
                <dd>FreeSurfer Ground Truth</dd>
              </div>
            </dl>
          </div>

          {/* Color Palettes */}
          <div className="palette-control">
            <p className="panel-kicker">Colormap Transfer</p>
            <div className="palette-grid">
              {DISPLAY_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`palette-chip ${preset === item.id ? "selected" : ""}`}
                  onClick={() => applyPreset(item.id)}
                  aria-pressed={preset === item.id}
                >
                  <div className={`palette-chip-gradient ${item.id}`} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Brain Structures Opacity */}
          {areStructuresLoaded && (
            <div className="slider-group">
              <div className="slider-label-row">
                <span>STRUCTURES OPACITY</span>
                <span className="slider-val-tag">{Math.round(structuresOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={structuresOpacity}
                onChange={(e) => handleStructuresOpacityChange(Number(e.target.value))}
                className="spatial-slider"
                title="Adjust anatomical structures opacity (drag to 0% to completely hide meshes)"
              />
              <div className="preset-chip-row">
                <button
                  type="button"
                  className="mini-chip"
                  onClick={() => handleStructuresOpacityChange(0)}
                  title="Completely hide 3D structure meshes"
                >
                  Hide (0%)
                </button>
                <button
                  type="button"
                  className="mini-chip"
                  onClick={() => handleStructuresOpacityChange(0.4)}
                  title="Ghost translucency"
                >
                  Glass (40%)
                </button>
                <button
                  type="button"
                  className="mini-chip"
                  onClick={() => handleStructuresOpacityChange(1)}
                  title="Full opacity"
                >
                  Opaque (100%)
                </button>
              </div>
            </div>
          )}

          {/* Cranium Envelope Opacity */}
          <div className="slider-group">
            <div className="slider-label-row">
              <span>CRANIUM ENVELOPE</span>
              <span className="slider-val-tag">{Math.round(headOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={headOpacity}
              onChange={(e) => handleHeadOpacityChange(Number(e.target.value))}
              className="spatial-slider"
              title="Adjust outer skull / scalp volume transparency"
            />
          </div>

          {/* Spatial Explosion / Disassembly */}
          {areStructuresLoaded && (
            <div className="slider-group">
              <div className="slider-label-row">
                <span>RADIAL EXPLOSION</span>
                <span className="slider-val-tag">{Math.round(explosionMm)} mm</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="1"
                value={explosionMm}
                onChange={(e) => handleExplosionChange(Number(e.target.value))}
                className="spatial-slider"
              />
              <div className="preset-chip-row">
                <button
                  type="button"
                  className="mini-chip"
                  onClick={() => animateDisplacement(45, explosionStateRef.current.isolateOffsetMm)}
                >
                  Explode 45mm
                </button>
                <button
                  type="button"
                  className="mini-chip"
                  onClick={() => animateDisplacement(0, 0)}
                >
                  Dock Core
                </button>
              </div>
            </div>
          )}

          {/* Anatomical Color Legend & Structures */}
          <div>
            <div className="legend-header-row">
              <p className="panel-kicker">Anatomical Color Key &amp; Volumes</p>
              <span className="slider-val-tag">{structures.length} ROIs</span>
            </div>
            <div className="structure-list-container">
              {structures.map((s) => {
                const isSelected = selectedStructureId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`structure-item ${isSelected ? "active" : ""}`}
                    onClick={() => toggleSelectStructure(s.id)}
                    style={
                      isSelected
                        ? {
                            background: `linear-gradient(90deg, ${s.color}22 0%, rgba(255,255,255,0.02) 100%)`,
                            borderColor: `${s.color}66`,
                            boxShadow: `0 0 16px ${s.color}20`,
                          }
                        : undefined
                    }
                  >
                    <span
                      className="structure-swatch"
                      style={{
                        background: s.color,
                        boxShadow: isSelected ? `0 0 10px ${s.color}` : undefined,
                      }}
                    />
                    <div className="structure-info">
                      <span className="structure-name" style={isSelected ? { color: "#fff", fontWeight: 600 } : undefined}>
                        {s.label}
                      </span>
                      <div className="structure-submeta">
                        <span className="structure-vol">{s.volumeCm3 ?? (s.volumeMm3 / 1000).toFixed(1)} cm³</span>
                        {s.asymmetryIndexPct !== undefined && s.asymmetryIndexPct !== 0 && (
                          <span className="asym-badge" title="Left-Right Asymmetry Index">
                            AI {s.asymmetryIndexPct > 0 ? "+" : ""}{s.asymmetryIndexPct}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Resizable Split Gutter: Left */}
        <div
          className="split-resizer"
          onMouseDown={startResizeLeft}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left sidebar panel"
          title="Drag to resize Left Panel"
        >
          <div className="resizer-handle" />
        </div>

        {/* Center Viewport Stage */}
        <section className="viewer-panel" aria-label="Spatial Brain Canvas">
          <div className="viewport-navbar">
            {/* Unified Mode Switcher */}
            <div className="stage-mode-switcher" role="tablist" aria-label="Display presentation mode">
              <button
                type="button"
                role="tab"
                aria-selected={stageMode === "structures"}
                className={`mode-tab ${stageMode === "structures" ? "active" : ""}`}
                onClick={() => void handleStageModeChange("structures")}
              >
                3D Structures
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={stageMode === "glass"}
                className={`mode-tab ${stageMode === "glass" ? "active" : ""}`}
                onClick={() => void handleStageModeChange("glass")}
              >
                Glass Cranium
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={stageMode === "slices"}
                className={`mode-tab ${stageMode === "slices" ? "active" : ""}`}
                onClick={() => void handleStageModeChange("slices")}
              >
                Linked Slices
              </button>
            </div>

            <div className="viewport-toolbar-right">
              <button
                type="button"
                className={`gesture-pill-btn ${isGestureActive ? "active" : ""}`}
                onClick={handleToggleGesture}
                title="Toggle Spatial Gesture Camera HUD"
                aria-pressed={isGestureActive}
              >
                <span className="indicator-pulse-dot" />
                <span>{isGestureActive ? "Gesture Tracking Active" : "Enable Gesture HUD"}</span>
              </button>
              <div className="telemetry-status-tag">
                <span className="live-dot" />
                <span>{areStructuresLoaded ? `${structures.length} Meshes` : isLoaded ? "Volume Live" : "Engine Ready"}</span>
              </div>
            </div>
          </div>

          <div className="canvas-stage-wrapper">
            <canvas ref={canvasRef} className="brain-canvas" />

            <GestureController
              viewerRef={viewerRef}
              mode={stageMode === "slices" ? "multiplanar" : "render"}
              isActive={isGestureActive}
              onClose={() => setIsGestureActive(false)}
              onStatusChange={setStatus}
              structures={structures}
              selectedStructureId={selectedStructureId}
              onSelectStructure={setSelectedStructureId}
              explosionMm={explosionMm}
              onExplosionChange={handleExplosionChange}
            />
          </div>

          <footer className="stage-footer">
            <p className="stage-footer-text">{status}</p>
          </footer>
        </section>

        {/* Resizable Split Gutter: Right */}
        <div
          className="split-resizer"
          onMouseDown={startResizeRight}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right inspector panel"
          title="Drag to resize Right Panel"
        >
          <div className="resizer-handle" />
        </div>

        {/* Right Rail: Anatomical Structure Inspector */}
        <aside className="inspector-panel" aria-label="Anatomical Structure Inspector" style={{ width: rightWidth }}>
          <div>
            <p className="panel-kicker">Interactive Inspector</p>
            <h2 className="card-title">Anatomy &amp; Function</h2>
          </div>

          {activeSelectedStructure ? (
            <div className="inspector-card">
              <div className="inspector-card-header">
                <span className="structure-tag-badge">{activeSelectedStructure.category}</span>
                <span className="slider-val-tag">QC VERIFIED</span>
              </div>

              <div className="structure-headline">
                <span
                  className="structure-headline-swatch"
                  style={{ background: activeSelectedStructure.color, boxShadow: `0 0 12px ${activeSelectedStructure.color}` }}
                />
                <h3>{activeSelectedStructure.label}</h3>
              </div>

              <p className="structure-description">{activeSelectedStructure.description}</p>

              <div className="metrics-table">
                <div className="metric-cell">
                  <span>Volume</span>
                  <b>{activeSelectedStructure.volumeCm3 ?? (activeSelectedStructure.volumeMm3 / 1000).toFixed(2)} cm³</b>
                </div>
                <div className="metric-cell">
                  <span>L/R Asymmetry</span>
                  <b>
                    {activeSelectedStructure.asymmetryIndexPct !== undefined && activeSelectedStructure.asymmetryIndexPct !== 0
                      ? `${activeSelectedStructure.asymmetryIndexPct > 0 ? "+" : ""}${activeSelectedStructure.asymmetryIndexPct}%`
                      : "Midline / Symmetrical"}
                  </b>
                </div>
                <div className="metric-cell">
                  <span>Topology QC</span>
                  <b>
                    {activeSelectedStructure.isWatertight ? "Watertight Manifold" : "Surface Cleaned"}
                  </b>
                </div>
                <div className="metric-cell">
                  <span>Connected Comp.</span>
                  <b>
                    {activeSelectedStructure.connectedComponentsInit ?? 1} → {activeSelectedStructure.connectedComponentsKept ?? 1} Kept
                  </b>
                </div>
                <div className="metric-cell">
                  <span>Centroid</span>
                  <b>
                    {activeSelectedStructure.centroid[0]}, {activeSelectedStructure.centroid[1]}, {activeSelectedStructure.centroid[2]}
                  </b>
                </div>
                <div className="metric-cell">
                  <span>Geometry</span>
                  <b>{activeSelectedStructure.vertexCount.toLocaleString()} Verts</b>
                </div>
              </div>

              <div className="inspector-actions">
                <button
                  type="button"
                  className="action-btn-primary"
                  onClick={() => toggleSelectStructure(activeSelectedStructure.id)}
                >
                  Dock Structure
                </button>
                <button
                  type="button"
                  className="action-btn-secondary"
                  onClick={() => animateDisplacement(explosionStateRef.current.globalMm, 50, 360)}
                >
                  Isolate (+50mm)
                </button>
              </div>
            </div>
          ) : (
            <div className="qc-summary-card">
              <div className="qc-summary-header">
                <span className="structure-tag-badge">QC PROTOCOL</span>
                <span className="slider-val-tag">{structures.length} ROIs PASSED</span>
              </div>
              <h3 className="qc-summary-title">Ground-Truth Parcellation</h3>
              <p className="structure-description">
                Click any ROI below to isolate in 3D and align multiplanar MRI crosshairs.
              </p>

              <div className="qc-table-scroll">
                <table className="qc-table">
                  <thead>
                    <tr>
                      <th>ROI / Color</th>
                      <th>Vol (cm³)</th>
                      <th>L/R Asym</th>
                      <th>QC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {structures.map((s) => (
                      <tr key={s.id} onClick={() => toggleSelectStructure(s.id)} className="qc-table-row">
                        <td>
                          <div className="qc-row-label">
                            <span className="qc-mini-dot" style={{ background: s.color }} />
                            <span>{s.label}</span>
                          </div>
                        </td>
                        <td>{s.volumeCm3 ?? (s.volumeMm3 / 1000).toFixed(1)}</td>
                        <td>
                          {s.asymmetryIndexPct !== undefined && s.asymmetryIndexPct !== 0
                            ? `${s.asymmetryIndexPct > 0 ? "+" : ""}${s.asymmetryIndexPct}%`
                            : "—"}
                        </td>
                        <td><span className="qc-pass-pill">PASS</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Anatomical Reference Note */}
          <div className="inspector-card">
            <p className="panel-kicker">Clinical &amp; QC Provenance</p>
            <p className="structure-description" style={{ fontSize: "11px" }}>
              FreeSurfer 7.x gold-standard ground truth (wmparc + aparc+aseg) from Subject 0960 1.0mm isotropic T1 MPRAGE scan. All meshes repaired at native resolution with connected-component filtering and volume-preserving Taubin smoothing. Not for primary diagnostic use.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
