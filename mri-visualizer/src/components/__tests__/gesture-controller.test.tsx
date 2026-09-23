import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import GestureController, { type BrainStructure } from "../gesture-controller";
import type { Niivue } from "@niivue/niivue";

const mockStructures: BrainStructure[] = [
  {
    id: "thalamus_left",
    label: "Left Thalamus",
    category: "Subcortical",
    color: "#28d7ff",
    description: "Sensory relay station",
    meshFile: "/models/brain-structures/thalamus_left.obj",
    centroid: [10, -15, 5],
    volumeMm3: 7200,
    vertexCount: 1500,
    faceCount: 3000,
  },
];

// Mock @mediapipe/tasks-vision
vi.mock("@mediapipe/tasks-vision", () => {
  return {
    FilesetResolver: {
      forVisionTasks: vi.fn().mockResolvedValue({}),
    },
    HandLandmarker: {
      createFromOptions: vi.fn().mockResolvedValue({
        detectForVideo: vi.fn().mockReturnValue({ landmarks: [] }),
        close: vi.fn(),
      }),
    },
  };
});

describe("GestureController Component", () => {
  const dummyViewerRef = {
    current: {
      setScale: vi.fn(),
      setRenderAzimuthElevation: vi.fn(),
      drawScene: vi.fn(),
      scene: {
        renderAzimuth: 0,
        renderElevation: 0,
        crosshairPos: [0.5, 0.5, 0.5],
      },
    } as unknown as Niivue,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isActive is false", () => {
    const { container } = render(
      <GestureController
        viewerRef={dummyViewerRef}
        mode="render"
        isActive={false}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders HUD interface when isActive is true", async () => {
    render(
      <GestureController
        viewerRef={dummyViewerRef}
        mode="render"
        isActive={true}
        onClose={vi.fn()}
        structures={mockStructures}
        selectedStructureId={null}
        explosionMm={0}
      />
    );

    expect(screen.getByText("HOLO-GESTURE HUD")).toBeInTheDocument();
    expect(screen.getByText("GESTURE")).toBeInTheDocument();
    expect(screen.getByText("HANDS")).toBeInTheDocument();
    expect(screen.getByText("TARGET")).toBeInTheDocument();
    expect(screen.getByText("ALL 16")).toBeInTheDocument();
    expect(screen.getByText("PULL OUT")).toBeInTheDocument();
    expect(screen.getByText("DOCKED")).toBeInTheDocument();
    expect(screen.getByText("HOLOGRAPHIC GESTURE MANUAL")).toBeInTheDocument();
  });

  it("minimizes and expands HUD when minimize button is clicked", () => {
    render(
      <GestureController
        viewerRef={dummyViewerRef}
        mode="render"
        isActive={true}
        onClose={vi.fn()}
      />
    );

    const minimizeBtn = screen.getByRole("button", { name: "Minimize HUD" });
    expect(minimizeBtn).toBeInTheDocument();

    fireEvent.click(minimizeBtn);
    expect(screen.queryByText("HOLOGRAPHIC GESTURE MANUAL")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand HUD" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand HUD" }));
    expect(screen.getByText("HOLOGRAPHIC GESTURE MANUAL")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onCloseMock = vi.fn();
    render(
      <GestureController
        viewerRef={dummyViewerRef}
        mode="render"
        isActive={true}
        onClose={onCloseMock}
      />
    );

    const closeBtn = screen.getByRole("button", { name: "Disable gesture controls" });
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("displays target name and pull-out displacement when structure is selected", () => {
    render(
      <GestureController
        viewerRef={dummyViewerRef}
        mode="render"
        isActive={true}
        onClose={vi.fn()}
        structures={mockStructures}
        selectedStructureId="thalamus_left"
        explosionMm={42}
      />
    );

    expect(screen.getByText("Left Thalam")).toBeInTheDocument();
    expect(screen.getByText("+42mm")).toBeInTheDocument();
  });

  it("displays error banner when camera access fails", async () => {
    // Force mediaDevices.getUserMedia to fail
    const error = new Error("Permission denied");
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(error);

    const onStatusChangeMock = vi.fn();
    render(
      <GestureController
        viewerRef={dummyViewerRef}
        mode="render"
        isActive={true}
        onClose={vi.fn()}
        onStatusChange={onStatusChangeMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Camera / AI pipeline error:")).toBeInTheDocument();
      expect(screen.getByText("Permission denied")).toBeInTheDocument();
    });

    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);
    expect(screen.queryByText("Permission denied")).not.toBeInTheDocument();
  });
});
