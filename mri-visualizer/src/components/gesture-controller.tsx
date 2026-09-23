"use client";

import type { Niivue } from "@niivue/niivue";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface GestureControllerProps {
  viewerRef: RefObject<Niivue | null>;
  mode: "multiplanar" | "render";
  isActive: boolean;
  onClose: () => void;
  onStatusChange?: (status: string) => void;
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
  const mcps = [landmarks[5], landmarks[9], landmarks[13], landmarks[17]];

  let foldedCount = 0;
  for (let i = 0; i < 4; i++) {
    if (getDist(tips[i], wrist) < getDist(mcps[i], wrist) * 1.15) {
      foldedCount++;
    }
  }
  return foldedCount >= 3;
}

// Helper to detect index pointing
function isPointing(landmarks: Point3D[]): boolean {
  const wrist = landmarks[0];
  const indexTip = landmarks[8];
  const indexMcp = landmarks[5];
  const indexExtended = getDist(indexTip, wrist) > getDist(indexMcp, wrist) * 1.3;

  const otherTips = [landmarks[12], landmarks[16], landmarks[20]];
  const otherMcps = [landmarks[9], landmarks[13], landmarks[17]];
  let othersCurled = 0;
  for (let i = 0; i < 3; i++) {
    if (getDist(otherTips[i], wrist) < getDist(otherMcps[i], wrist) * 1.2) {
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
}: GestureControllerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [handCount, setHandCount] = useState(0);
  const [activeGesture, setActiveGesture] = useState<string>("CALIBRATING");
  const [telemetry, setTelemetry] = useState({ az: 0, el: 0, scale: 1.0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Tracking state refs for smooth temporal filtering
  const prevHandPosRef = useRef<{ x: number; y: number } | null>(null);
  const prevTwoHandDistRef = useRef<number | null>(null);
  const prevPinchDistRef = useRef<number | null>(null);
  const smoothedPosRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const currentScaleRef = useRef<number>(1.0);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const handleLandmarks = useCallback(
    (landmarksList: Point3D[][], ctx: CanvasRenderingContext2D, width: number, height: number) => {
      setHandCount(landmarksList.length);

      if (landmarksList.length === 0) {
        setActiveGesture("AWAITING HANDS");
        prevHandPosRef.current = null;
        prevTwoHandDistRef.current = null;
        prevPinchDistRef.current = null;
        return;
      }

      // Render futuristic HUD graphics on canvas
      ctx.clearRect(0, 0, width, height);

      // Draw subtle holographic grid lines
      ctx.strokeStyle = "rgba(40, 215, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
      ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      landmarksList.forEach((landmarks, handIndex) => {
        // Mirrored coordinate space (1 - x) so movements mirror user's perspective
        const pts = landmarks.map((p) => ({
          x: (1 - p.x) * width,
          y: p.y * height,
          normX: 1 - p.x,
          normY: p.y,
        }));

        // Draw Iron Man bone connections (glowing cyan vectors)
        ctx.strokeStyle = handIndex === 0 ? "rgba(40, 215, 255, 0.75)" : "rgba(188, 243, 75, 0.75)";
        ctx.lineWidth = 2;
        ctx.shadowColor = handIndex === 0 ? "#28d7ff" : "#bcf34b";
        ctx.shadowBlur = 8;

        for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
          const p1 = pts[startIdx];
          const p2 = pts[endIdx];
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }

        // Draw joint nodes
        ctx.shadowBlur = 4;
        pts.forEach((p, idx) => {
          const isTip = [4, 8, 12, 16, 20].includes(idx);
          ctx.fillStyle = isTip ? "#ffffff" : handIndex === 0 ? "#28d7ff" : "#bcf34b";
          ctx.beginPath();
          ctx.arc(p.x, p.y, isTip ? 4 : 2.5, 0, 2 * Math.PI);
          ctx.fill();

          // Outer reticle on fingertips
          if (isTip) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
            ctx.stroke();
          }
        });

        // Draw targeting ring on palm center
        const palmCenter = {
          x: (pts[0].x + pts[5].x + pts[9].x + pts[13].x + pts[17].x) / 5,
          y: (pts[0].y + pts[5].y + pts[9].y + pts[13].y + pts[17].y) / 5,
        };

        ctx.strokeStyle = "rgba(40, 215, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(palmCenter.x, palmCenter.y, 14, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(palmCenter.x, palmCenter.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = "#28d7ff";
        ctx.fill();
      });

      // Reset canvas shadow for clean UI performance
      ctx.shadowBlur = 0;

      // -------------------------------------------------------------
      // GESTURE RECOGNITION & VIEWPORT MANIPULATION
      // -------------------------------------------------------------
      const viewer = viewerRef.current;
      if (!viewer) return;

      const currentMode = modeRef.current;

      // Scenario A: TWO HANDS -> Holographic Iron Man Expand / Collapse (Zoom)
      if (landmarksList.length >= 2) {
        const h1 = landmarksList[0][0]; // wrist 1
        const h2 = landmarksList[1][0]; // wrist 2
        // Mirrored X distance
        const currentTwoHandDist = Math.hypot((1 - h1.x) - (1 - h2.x), h1.y - h2.y);

        if (prevTwoHandDistRef.current !== null) {
          const delta = currentTwoHandDist - prevTwoHandDistRef.current;
          if (Math.abs(delta) > 0.005) {
            // Pulling apart zooms in, bringing together zooms out
            const nextScale = Math.max(0.4, Math.min(4.0, currentScaleRef.current * (1 + delta * 2.2)));
            currentScaleRef.current = nextScale;
            viewer.setScale(nextScale);
            setTelemetry((prev) => ({ ...prev, scale: Number(nextScale.toFixed(2)) }));
          }
        }
        prevTwoHandDistRef.current = currentTwoHandDist;
        setActiveGesture("TWO-HAND EXPAND");
        return;
      }

      // Scenario B: SINGLE HAND
      prevTwoHandDistRef.current = null;
      const hand = landmarksList[0];
      const wrist = hand[0];
      const thumbTip = hand[4];
      const indexTip = hand[8];

      // Mirrored coordinates for interaction
      const palmX = (1 - ((wrist.x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5));
      const palmY = (wrist.y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5;

      // Smooth coordinate with EMA filter
      smoothedPosRef.current = {
        x: smoothedPosRef.current.x * 0.7 + palmX * 0.3,
        y: smoothedPosRef.current.y * 0.7 + palmY * 0.3,
      };

      const pinchDist = Math.hypot((1 - thumbTip.x) - (1 - indexTip.x), thumbTip.y - indexTip.y);
      const fistDetected = isFist(hand);
      const pointingDetected = isPointing(hand);

      // Pinch state
      const isPinched = pinchDist < 0.085;

      if (currentMode === "render") {
        // 3D VOLUME MODE
        if (isPinched) {
          // Pinch-to-zoom
          if (prevPinchDistRef.current !== null) {
            const deltaPinch = pinchDist - prevPinchDistRef.current;
            if (Math.abs(deltaPinch) > 0.003) {
              const nextScale = Math.max(0.4, Math.min(4.0, currentScaleRef.current * (1 + deltaPinch * 3.5)));
              currentScaleRef.current = nextScale;
              viewer.setScale(nextScale);
              setTelemetry((prev) => ({ ...prev, scale: Number(nextScale.toFixed(2)) }));
            }
          }
          prevPinchDistRef.current = pinchDist;
          setActiveGesture("PINCH ZOOM");
          prevHandPosRef.current = null;
        } else if (fistDetected) {
          // Closed fist drag -> 3D Volume Orbit (Azimuth & Elevation)
          prevPinchDistRef.current = null;
          setActiveGesture("FIST ORBIT");

          if (prevHandPosRef.current) {
            const dx = smoothedPosRef.current.x - prevHandPosRef.current.x;
            const dy = smoothedPosRef.current.y - prevHandPosRef.current.y;

            if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) {
              const curAzimuth = viewer.scene.renderAzimuth ?? 0;
              const curElevation = viewer.scene.renderElevation ?? 0;

              const nextAzimuth = Math.round((curAzimuth + dx * 220) % 360);
              const nextElevation = Math.max(-85, Math.min(85, Math.round(curElevation - dy * 180)));

              viewer.setRenderAzimuthElevation(nextAzimuth, nextElevation);
              setTelemetry((prev) => ({
                ...prev,
                az: nextAzimuth,
                el: nextElevation,
              }));
            }
          }
          prevHandPosRef.current = { ...smoothedPosRef.current };
        } else {
          // Open palm / neutral hover
          prevHandPosRef.current = null;
          prevPinchDistRef.current = null;
          setActiveGesture("PALM HOVER");
        }
      } else {
        // MULTIPLANAR LINKED SLICES MODE
        prevPinchDistRef.current = null;

        if (pointingDetected) {
          // Pointing index finger sweeps the slice crosshairs
          setActiveGesture("POINT SLICE");
          const indexNormX = Math.max(0.05, Math.min(0.95, 1 - indexTip.x));
          const indexNormY = Math.max(0.05, Math.min(0.95, indexTip.y));

          // Map hand coordinate to crosshairs [x, y, z]
          const curPos = viewer.scene.crosshairPos;
          if (curPos) {
            const nextZ = curPos[2] ?? 0.5;
            viewer.scene.crosshairPos = [indexNormX, 1 - indexNormY, nextZ];
            viewer.drawScene();
          }
        } else if (isPinched) {
          setActiveGesture("PINCH ACTIVE");
        } else {
          setActiveGesture("HOVER READY");
        }
      }
    },
    [viewerRef]
  );

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
        onStatusChange?.("Initializing MediaPipe HandLandmarker…");
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
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        if (!isMounted) {
          handLandmarker?.close();
          return;
        }

        onStatusChange?.("Requesting camera access for Iron Man gesture control…");

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

        onStatusChange?.("Holographic gesture controls online · raise your hand.");

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
            canvas.width = video.videoWidth || 320;
            canvas.height = video.videoHeight || 240;

            const ctx = canvas.getContext("2d");
            if (ctx) {
              const startTimeMs = performance.now();
              const results = handLandmarker.detectForVideo(video, startTimeMs);
              handleLandmarks(results.landmarks || [], ctx, canvas.width, canvas.height);
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
        onStatusChange?.(`Gesture control error: ${msg}`);
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
  }, [handleLandmarks, isActive, onStatusChange]);

  if (!isActive) return null;

  return (
    <aside
      className={`holo-hud-panel ${isMinimized ? "minimized" : ""}`}
      aria-label="Iron Man Holographic Gesture Telemetry HUD"
    >
      <header className="holo-hud-header">
        <div className="holo-title">
          <span className="holo-pulse-dot" />
          <span>HOLO-GESTURE HUD</span>
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
                    <b className="badge-val">{activeGesture}</b>
                  </div>
                  <div className="holo-badge">
                    <span className="badge-kicker">HANDS</span>
                    <b className="badge-val">{handCount}</b>
                  </div>
                </div>
              </div>

              {/* Iron Man Telemetry Readout */}
              <div className="holo-telemetry-stats">
                <div>
                  <dt>ORBIT (AZ/EL)</dt>
                  <dd>{telemetry.az}° / {telemetry.el}°</dd>
                </div>
                <div>
                  <dt>SCALE</dt>
                  <dd>{telemetry.scale}x</dd>
                </div>
                <div>
                  <dt>MODE</dt>
                  <dd>{mode === "render" ? "3D VOLUME" : "SLICES"}</dd>
                </div>
              </div>

              <div className="holo-guide">
                <p className="holo-guide-title">GESTURE MANUAL</p>
                <ul>
                  <li><b>Fist Drag:</b> Orbit 3D volume horizontally &amp; vertically</li>
                  <li><b>Pinch / 2 Hands:</b> Dynamic holographic zoom (expand/collapse)</li>
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
