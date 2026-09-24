"use client";

import type { Niivue } from "@niivue/niivue";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface BrainStructure {
  id: string;
  label: string;
  category: string;
  color: string;
  description: string;
  meshFile: string;
  centroid: [number, number, number];
  volumeMm3: number;
  volumeCm3?: number;
  lhVolumeMm3?: number;
  rhVolumeMm3?: number;
  asymmetryIndexPct?: number;
  connectedComponentsInit?: number;
  connectedComponentsKept?: number;
  vertexCount: number;
  faceCount: number;
  isWatertight?: boolean;
  eulerCharacteristic?: number;
}

interface GestureControllerProps {
  viewerRef: RefObject<Niivue | null>;
  mode: "multiplanar" | "render";
  isActive: boolean;
  onClose: () => void;
  onStatusChange?: (status: string) => void;
  structures?: BrainStructure[];
  selectedStructureId?: string | null;
  onSelectStructure?: (id: string | null) => void;
  explosionMm?: number;
  onExplosionChange?: (mm: number) => void;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

// MediaPipe Hand landmark connection pairs for wireframe skeleton rendering
const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm base
  [5, 9], [9, 13], [13, 17],
];

// Helper to compute Euclidean distance
function getDist(p1: Point3D, p2: Point3D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Helper to detect if hand is curled into a fist
function isFist(landmarks: Point3D[]): boolean {
  const wrist = landmarks[0];
  const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
  const pips = [landmarks[6], landmarks[10], landmarks[14], landmarks[18]];
  const mcps = [landmarks[5], landmarks[9], landmarks[13], landmarks[17]];

  let foldedCount = 0;
  for (let i = 0; i < 4; i++) {
    const tipWrist = getDist(tips[i], wrist);
    const pipWrist = getDist(pips[i], wrist);
    const tipMcp = getDist(tips[i], mcps[i]);
    const pipMcp = getDist(pips[i], mcps[i]);

    // Finger is curled when tip is folded back towards palm (closer to wrist than PIP, or curled near MCP)
    if (tipWrist < pipWrist * 1.05 || tipMcp < pipMcp * 0.95) {
      foldedCount++;
    }
  }
  return foldedCount >= 3;
}

// Helper to detect index pointing
function isPointing(landmarks: Point3D[]): boolean {
  const wrist = landmarks[0];
  const indexTip = landmarks[8];
  const indexPip = landmarks[6];
  const indexMcp = landmarks[5];
  const indexExtended =
    getDist(indexTip, wrist) > getDist(indexPip, wrist) * 1.15 &&
    getDist(indexTip, indexMcp) > getDist(indexPip, indexMcp) * 1.1;

  const otherTips = [landmarks[12], landmarks[16], landmarks[20]];
  const otherPips = [landmarks[10], landmarks[14], landmarks[18]];
  const otherMcps = [landmarks[9], landmarks[13], landmarks[17]];
  let othersCurled = 0;
  for (let i = 0; i < 3; i++) {
    if (
      getDist(otherTips[i], wrist) < getDist(otherPips[i], wrist) * 1.05 ||
      getDist(otherTips[i], otherMcps[i]) < getDist(otherPips[i], otherMcps[i]) * 0.95
    ) {
      othersCurled++;
    }
  }
  return indexExtended && othersCurled >= 2;
}

export default function GestureController({
  viewerRef,
  mode,
  isActive,
  onClose,
  onStatusChange,
  structures = [],
  selectedStructureId = null,
  onSelectStructure,
  explosionMm = 0,
  onExplosionChange,
}: GestureControllerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Fast direct DOM refs for 60fps telemetry (bypasses React re-renders)
  const gestureBadgeRef = useRef<HTMLElement>(null);
  const handCountBadgeRef = useRef<HTMLElement>(null);
  const pullOutRef = useRef<HTMLElement>(null);
  const orbitRef = useRef<HTMLElement>(null);

  const [handCount] = useState(0);
  const [activeGesture] = useState<string>("CALIBRATING");
  const [telemetry] = useState({ az: 0, el: 0, scale: 1.0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Tracking state refs for smooth temporal filtering
  const prevHandPosRef = useRef<{ x: number; y: number } | null>(null);
  const prevTwoHandDistRef = useRef<number | null>(null);
  const prevPinchDistRef = useRef<number | null>(null);
  const smoothedPosRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const currentScaleRef = useRef<number>(1.0);
  const modeRef = useRef(mode);
  const explosionRef = useRef(explosionMm);
  const lastReportedExplosionRef = useRef(explosionMm);
  const selectedStructRef = useRef(selectedStructureId);
  const onExplosionChangeRef = useRef(onExplosionChange);
  const onSelectStructureRef = useRef(onSelectStructure);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    explosionRef.current = explosionMm;
    if (pullOutRef.current) {
      pullOutRef.current.textContent = explosionMm > 0 ? `+${Math.round(explosionMm)}mm` : "DOCKED";
    }
  }, [explosionMm]);

  useEffect(() => {
    selectedStructRef.current = selectedStructureId;
  }, [selectedStructureId]);

  useEffect(() => {
    onExplosionChangeRef.current = onExplosionChange;
    onSelectStructureRef.current = onSelectStructure;
    onStatusChangeRef.current = onStatusChange;
  }, [onExplosionChange, onSelectStructure, onStatusChange]);

  const activeStructure = structures.find((s) => s.id === selectedStructureId);

  const updateGestureDisplay = useCallback((name: string) => {
    if (gestureBadgeRef.current && gestureBadgeRef.current.textContent !== name) {
      gestureBadgeRef.current.textContent = name;
    }
  }, []);

  const updateHandCountDisplay = useCallback((count: number) => {
    if (handCountBadgeRef.current && handCountBadgeRef.current.textContent !== String(count)) {
      handCountBadgeRef.current.textContent = String(count);
    }
  }, []);

  const updateOrbitDisplay = useCallback((az: number, el: number) => {
    if (orbitRef.current) {
      orbitRef.current.textContent = `${az}°/${el}°`;
    }
  }, []);

  const updatePullOutDisplay = useCallback((mm: number) => {
    if (pullOutRef.current) {
      pullOutRef.current.textContent = mm > 0 ? `+${Math.round(mm)}mm` : "DOCKED";
    }
  }, []);

  const handleLandmarks = useCallback(
    (landmarksList: Point3D[][], ctx: CanvasRenderingContext2D, width: number, height: number) => {
      updateHandCountDisplay(landmarksList.length);

      if (landmarksList.length === 0) {
        updateGestureDisplay("AWAITING HANDS");
        prevHandPosRef.current = null;
        prevTwoHandDistRef.current = null;
        prevPinchDistRef.current = null;
        return;
      }

      // Render futuristic HUD graphics on canvas (optimized 2D drawing without shadowBlur)
      ctx.clearRect(0, 0, width, height);

      // Subtle holographic grid lines
      ctx.strokeStyle = "rgba(40, 215, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
      ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      landmarksList.forEach((landmarks, handIndex) => {
        // Mirrored coordinate space (1 - x)
        const pts = landmarks.map((p) => ({
          x: (1 - p.x) * width,
          y: p.y * height,
        }));

        const isPrimary = handIndex === 0;
        const glowColor = isPrimary ? "rgba(40, 215, 255, 0.28)" : "rgba(188, 243, 75, 0.28)";
        const coreColor = isPrimary ? "rgba(40, 215, 255, 0.9)" : "rgba(188, 243, 75, 0.9)";
        const pointColor = isPrimary ? "#28d7ff" : "#bcf34b";

        // Pass 1: Batched glow stroke (wide alpha stroke replaces expensive shadowBlur)
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
          ctx.moveTo(pts[startIdx].x, pts[startIdx].y);
          ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
        }
        ctx.stroke();

        // Pass 2: Batched crisp vector core line
        ctx.strokeStyle = coreColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
          ctx.moveTo(pts[startIdx].x, pts[startIdx].y);
          ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
        }
        ctx.stroke();

        // Pass 3: Batched non-tip joint nodes
        ctx.fillStyle = pointColor;
        ctx.beginPath();
        pts.forEach((p, idx) => {
          if (![4, 8, 12, 16, 20].includes(idx)) {
            ctx.moveTo(p.x + 2.5, p.y);
            ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
          }
        });
        ctx.fill();

        // Pass 4: Fingertip markers with targeting rings
        pts.forEach((p, idx) => {
          if ([4, 8, 12, 16, 20].includes(idx)) {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
            ctx.fill();

            ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 6.5, 0, 2 * Math.PI);
            ctx.stroke();
          }
        });

        // Palm targeting ring
        const palmCenterX = (pts[0].x + pts[5].x + pts[9].x + pts[13].x + pts[17].x) / 5;
        const palmCenterY = (pts[0].y + pts[5].y + pts[9].y + pts[13].y + pts[17].y) / 5;

        ctx.strokeStyle = "rgba(40, 215, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(palmCenterX, palmCenterY, 13, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(palmCenterX, palmCenterY, 3, 0, 2 * Math.PI);
        ctx.fillStyle = "#28d7ff";
        ctx.fill();
      });

      // -------------------------------------------------------------
      // GESTURE RECOGNITION & VIEWPORT MANIPULATION
      // -------------------------------------------------------------
      const viewer = viewerRef.current;
      if (!viewer) return;

      const currentMode = modeRef.current;

      // Scenario A: TWO HANDS -> Disassembly if structures exist, or Volume Zoom
      if (landmarksList.length >= 2) {
        const h1 = landmarksList[0][0]; // wrist 1
        const h2 = landmarksList[1][0]; // wrist 2
        const currentTwoHandDist = Math.hypot((1 - h1.x) - (1 - h2.x), h1.y - h2.y);

        if (prevTwoHandDistRef.current !== null) {
          const delta = currentTwoHandDist - prevTwoHandDistRef.current;
          if (Math.abs(delta) > 0.0015) {
            if (viewer.meshes && viewer.meshes.length > 0) {
              // Pulling two hands apart expands/explodes the 16 brain structures outward!
              const nextExplosion = Math.max(0, Math.min(80, explosionRef.current + delta * 200));
              updatePullOutDisplay(nextExplosion);
              if (Math.abs(nextExplosion - lastReportedExplosionRef.current) >= 0.2) {
                lastReportedExplosionRef.current = nextExplosion;
                onExplosionChangeRef.current?.(Number(nextExplosion.toFixed(1)));
              }
              updateGestureDisplay("HOLO DISASSEMBLY");
            } else {
              // Zoom volume view with two hands when meshes are not mounted
              const nextScale = Math.max(0.4, Math.min(4.0, currentScaleRef.current * (1 + delta * 2.5)));
              currentScaleRef.current = nextScale;
              viewer.setScale(nextScale);
              updateGestureDisplay("TWO-HAND ZOOM");
            }
          }
        }
        prevTwoHandDistRef.current = currentTwoHandDist;
        return;
      }

      // Scenario B: SINGLE HAND INTERACTION
      prevTwoHandDistRef.current = null;
      const hand = landmarksList[0];
      const wrist = hand[0];
      const thumbTip = hand[4];
      const indexTip = hand[8];

      // Mirrored coordinates for interaction
      const palmX = 1 - ((wrist.x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5);
      const palmY = (wrist.y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5;

      // Responsive EMA filter (lower inertia for snappier tracking)
      smoothedPosRef.current = {
        x: smoothedPosRef.current.x * 0.4 + palmX * 0.6,
        y: smoothedPosRef.current.y * 0.4 + palmY * 0.6,
      };

      const pinchDist = Math.hypot((1 - thumbTip.x) - (1 - indexTip.x), thumbTip.y - indexTip.y);
      const fistDetected = isFist(hand);
      const pointingDetected = isPointing(hand);
      const isPinched = pinchDist < 0.105;

      if (currentMode === "render") {
        // 3D VOLUME MODE
        if (isPinched) {
          // If a specific structure is selected, Pinch & Pull controls its extraction!
          if (selectedStructRef.current) {
            if (prevHandPosRef.current) {
              const dy = smoothedPosRef.current.y - prevHandPosRef.current.y;
              if (Math.abs(dy) > 0.0015) {
                // Moving hand up/outward pulls structure out (+mm), down pushes it back
                const nextExplosion = Math.max(0, Math.min(80, explosionRef.current - dy * 160));
                updatePullOutDisplay(nextExplosion);
                if (Math.abs(nextExplosion - lastReportedExplosionRef.current) >= 0.2) {
                  lastReportedExplosionRef.current = nextExplosion;
                  onExplosionChangeRef.current?.(Number(nextExplosion.toFixed(1)));
                }
              }
            }
            prevHandPosRef.current = { ...smoothedPosRef.current };
            updateGestureDisplay("PINCH & PULL");
          } else {
            // General pinch to zoom: move pinched hand UP to zoom in, DOWN to zoom out
            if (prevHandPosRef.current) {
              const dy = smoothedPosRef.current.y - prevHandPosRef.current.y;
              if (Math.abs(dy) > 0.0015) {
                const nextScale = Math.max(0.4, Math.min(4.0, currentScaleRef.current * (1 - dy * 3.5)));
                currentScaleRef.current = nextScale;
                viewer.setScale(nextScale);
              }
            }
            prevHandPosRef.current = { ...smoothedPosRef.current };
            updateGestureDisplay("PINCH ZOOM");
          }
        } else if (fistDetected) {
          // Closed fist drag -> 3D Volume Orbit (Azimuth & Elevation)
          updateGestureDisplay("FIST ORBIT");

          if (prevHandPosRef.current) {
            const dx = smoothedPosRef.current.x - prevHandPosRef.current.x;
            const dy = smoothedPosRef.current.y - prevHandPosRef.current.y;

            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
              const curAzimuth = viewer.scene.renderAzimuth ?? 0;
              const curElevation = viewer.scene.renderElevation ?? 0;

              const nextAzimuth = Math.round((curAzimuth + dx * 380 + 3600) % 360);
              const nextElevation = Math.max(-85, Math.min(85, Math.round(curElevation - dy * 300)));

              viewer.setRenderAzimuthElevation(nextAzimuth, nextElevation);
              updateOrbitDisplay(nextAzimuth, nextElevation);
            }
          }
          prevHandPosRef.current = { ...smoothedPosRef.current };
        } else {
          // Open palm / neutral hover
          prevHandPosRef.current = null;
          updateGestureDisplay("PALM HOVER");
        }
      } else {
        // MULTIPLANAR LINKED SLICES MODE
        if (pointingDetected) {
          // Pointing index finger sweeps the slice crosshairs
          updateGestureDisplay("POINT SLICE");
          const indexNormX = Math.max(0.05, Math.min(0.95, 1 - indexTip.x));
          const indexNormY = Math.max(0.05, Math.min(0.95, indexTip.y));

          // Map hand coordinate to crosshairs [x, y, z]
          const curPos = viewer.scene.crosshairPos;
          if (curPos) {
            viewer.scene.crosshairPos = [indexNormX, 1 - indexNormY, curPos[2] ?? 0.5];
            viewer.drawScene();
            if (typeof viewer.createOnLocationChange === "function") {
              viewer.createOnLocationChange();
            }
          }
          prevHandPosRef.current = null;
        } else if (fistDetected) {
          // Fist drag scrolls the slice in 2D
          updateGestureDisplay("SLICE SCROLL");
          if (prevHandPosRef.current) {
            const dy = smoothedPosRef.current.y - prevHandPosRef.current.y;
            if (Math.abs(dy) > 0.0015) {
              const curPos = viewer.scene.crosshairPos;
              if (curPos) {
                const nextZ = Math.max(0.02, Math.min(0.98, (curPos[2] ?? 0.5) - dy * 2.0));
                viewer.scene.crosshairPos = [curPos[0], curPos[1], nextZ];
                viewer.drawScene();
                if (typeof viewer.createOnLocationChange === "function") {
                  viewer.createOnLocationChange();
                }
              }
            }
          }
          prevHandPosRef.current = { ...smoothedPosRef.current };
        } else if (isPinched) {
          updateGestureDisplay("PINCH ACTIVE");
          prevHandPosRef.current = null;
        } else {
          updateGestureDisplay("HOVER READY");
          prevHandPosRef.current = null;
        }
      }
    },
    [updateGestureDisplay, updateHandCountDisplay, updateOrbitDisplay, updatePullOutDisplay, viewerRef]
  );

  const handleLandmarksRef = useRef(handleLandmarks);
  useEffect(() => {
    handleLandmarksRef.current = handleLandmarks;
  }, [handleLandmarks]);

  // Initialize MediaPipe and Webcam Video Stream
  useEffect(() => {
    if (!isActive) return;

    let isMounted = true;
    let handLandmarker: {
      detectForVideo: (
        video: HTMLVideoElement,
        timestamp: number
      ) => { landmarks: Point3D[][] };
      close: () => void;
    } | null = null;

    async function setupTracking() {
      try {
        onStatusChangeRef.current?.("Initializing MediaPipe HandLandmarker…");
        setErrorMessage(null);

        // Dynamically load @mediapipe/tasks-vision client-side
        const { FilesetResolver, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );

        if (!isMounted) return;

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
        );

        if (!isMounted) return;

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!isMounted) {
          handLandmarker?.close();
          return;
        }

        onStatusChangeRef.current?.("Requesting camera access for Iron Man gesture control…");

        // Access webcam stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          handLandmarker?.close();
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        onStatusChangeRef.current?.("Holographic gesture controls online · raise hands to orbit or pull structures.");

        // Detection render loop
        let lastVideoTime = -1;
        const processFrame = () => {
          if (!isMounted) return;

          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (
            video &&
            canvas &&
            video.readyState >= 2 &&
            handLandmarker &&
            video.currentTime !== lastVideoTime
          ) {
            lastVideoTime = video.currentTime;
            const targetW = video.videoWidth || 320;
            const targetH = video.videoHeight || 240;
            if (canvas.width !== targetW || canvas.height !== targetH) {
              canvas.width = targetW;
              canvas.height = targetH;
            }

            const ctx = canvas.getContext("2d");
            if (ctx) {
              const startTimeMs = performance.now();
              const results = handLandmarker.detectForVideo(video, startTimeMs);
              handleLandmarksRef.current(results.landmarks || [], ctx, canvas.width, canvas.height);
            }
          }

          animFrameRef.current = requestAnimationFrame(processFrame);
        };

        animFrameRef.current = requestAnimationFrame(processFrame);
      } catch (err) {
        if (!isMounted) return;
        const msg =
          err instanceof Error
            ? err.message
            : "Camera or MediaPipe initialization failed.";
        setErrorMessage(msg);
        onStatusChangeRef.current?.(`Gesture control error: ${msg}`);
      }
    }

    void setupTracking();

    return () => {
      isMounted = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (handLandmarker) {
        handLandmarker.close();
      }
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <aside
      className={`holo-hud-panel ${isMinimized ? "minimized" : ""}`}
      aria-label="Spatial Gesture Telemetry Controller"
    >
      <header className="holo-hud-header">
        <div className="holo-title">
          <span className="indicator-pulse-dot" />
          <span>SPATIAL GESTURE</span>
        </div>
        <div className="holo-hud-controls">
          <button
            type="button"
            className="holo-btn-icon"
            onClick={() => setIsMinimized((prev) => !prev)}
            title={isMinimized ? "Expand HUD" : "Minimize HUD"}
            aria-label={isMinimized ? "Expand HUD" : "Minimize HUD"}
          >
            {isMinimized ? "▲" : "▼"}
          </button>
          <button
            type="button"
            className="holo-btn-icon"
            onClick={onClose}
            title="Disable gesture controls"
            aria-label="Disable gesture controls"
          >
            ✕
          </button>
        </div>
      </header>

      {!isMinimized && (
        <div className="holo-hud-body">
          {errorMessage ? (
            <div className="holo-error">
              <p>Camera / AI pipeline error:</p>
              <small>{errorMessage}</small>
              <button
                type="button"
                className="holo-retry-btn"
                onClick={() => {
                  setErrorMessage(null);
                  onClose();
                }}
              >
                Dismiss
              </button>
            </div>
          ) : (
            <>
              <div className="holo-video-viewport">
                <video
                  ref={videoRef}
                  className="holo-video"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="holo-canvas" />
                <div className="holo-reticle-scan" aria-hidden="true" />

                {/* Cybernetic HUD Corner Brackets */}
                <div className="holo-bracket top-left" />
                <div className="holo-bracket top-right" />
                <div className="holo-bracket bottom-left" />
                <div className="holo-bracket bottom-right" />

                {/* Real-time telemetry badges */}
                <div className="holo-telemetry-overlay">
                  <div className="holo-badge">
                    <span className="badge-kicker">GESTURE</span>
                    <b className="badge-val" ref={gestureBadgeRef}>{activeGesture}</b>
                  </div>
                  <div className="holo-badge">
                    <span className="badge-kicker">HANDS</span>
                    <b className="badge-val" ref={handCountBadgeRef}>{handCount}</b>
                  </div>
                </div>
              </div>

              {/* Iron Man Telemetry Readout */}
              <div className="holo-telemetry-stats">
                <div>
                  <dt>TARGET</dt>
                  <dd className="telemetry-highlight">
                    {activeStructure ? activeStructure.label.slice(0, 11) : "ALL 16"}
                  </dd>
                </div>
                <div>
                  <dt>PULL OUT</dt>
                  <dd ref={pullOutRef}>{explosionMm > 0 ? `+${Math.round(explosionMm)}mm` : "DOCKED"}</dd>
                </div>
                <div>
                  <dt>ORBIT</dt>
                  <dd ref={orbitRef}>{telemetry.az}°/{telemetry.el}°</dd>
                </div>
              </div>

              <div className="holo-guide">
                <p className="holo-guide-title">HOLOGRAPHIC GESTURE MANUAL</p>
                <ul>
                  <li><b>Two Hands Pull Apart:</b> Holographic core explode / disassemble all 16 structures</li>
                  <li><b>Pinch &amp; Pull:</b> Grab selected brain structure &amp; pull out in 3D</li>
                  <li><b>Closed Fist Drag:</b> Orbit 3D volume view</li>
                  <li><b>Index Point:</b> Sweep crosshair slice position</li>
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
