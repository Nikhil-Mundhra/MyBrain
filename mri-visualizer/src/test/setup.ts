import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock HTMLCanvasElement.getContext
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextId: string) => {
  if (contextId === "2d") {
    return {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      shadowColor: "",
      shadowBlur: 0,
    };
  }
  return null;
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Mock HTMLMediaElement play/pause
window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
window.HTMLMediaElement.prototype.pause = vi.fn();

// Mock requestAnimationFrame / cancelAnimationFrame
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(() => callback(performance.now()), 16) as unknown as number;
  };
}
if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}

// Mock navigator.mediaDevices
Object.defineProperty(navigator, "mediaDevices", {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [
        {
          stop: vi.fn(),
        },
      ],
    }),
  },
});

// Mock @niivue/niivue
vi.mock("@niivue/niivue", () => {
  class MockNiivue {
    attachToCanvas = vi.fn().mockResolvedValue(undefined);
    setSliceType = vi.fn();
    setCrosshairColor = vi.fn();
    setColormap = vi.fn();
    setScale = vi.fn();
    setRenderAzimuthElevation = vi.fn();
    drawScene = vi.fn();
    loadFromFile = vi.fn().mockResolvedValue(undefined);
    loadMeshes = vi.fn().mockResolvedValue(undefined);
    removeMesh = vi.fn().mockImplementation((mesh: unknown) => {
      const idx = this.meshes.indexOf(mesh as (typeof this.meshes)[number]);
      if (idx !== -1) {
        this.meshes.splice(idx, 1);
      } else {
        this.meshes.shift();
      }
    });
    setOpacity = vi.fn();
    mm2frac = vi.fn().mockReturnValue([0.5, 0.5, 0.5]);
    sliceTypeMultiplanar = 0;
    sliceTypeRender = 4;
    volumes = [{ id: "test-volume" }];
    meshes = [
      {
        name: "thalamus_left",
        pts: new Float32Array([10, 20, 30, 40, 50, 60]),
        updateMesh: vi.fn(),
      },
    ];
    scene = {
      renderAzimuth: 0,
      renderElevation: 0,
      crosshairPos: [0.5, 0.5, 0.5],
    };
    opts = {
      multiplanarShowRender: 0,
    };
    gl = {};
  }

  return {
    Niivue: MockNiivue,
    SHOW_RENDER: {
      NEVER: 0,
      ALWAYS: 1,
      AUTO: 2,
    },
  };
});
