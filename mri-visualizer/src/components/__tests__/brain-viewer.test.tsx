import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BrainViewer from "../brain-viewer";

const mockStructures = [
  {
    id: "thalamus_left",
    label: "Left Thalamus",
    category: "Subcortical",
    color: "#28d7ff",
    description: "Sensory relay station",
    meshFile: "/models/brain-structures/thalamus_left.obj",
    centroid: [10, -15, 5] as [number, number, number],
    volumeMm3: 7200,
    vertexCount: 1500,
    faceCount: 3000,
  },
  {
    id: "hippocampus_left",
    label: "Left Hippocampus",
    category: "Limbic",
    color: "#bcf34b",
    description: "Memory consolidation",
    meshFile: "/models/brain-structures/hippocampus_left.obj",
    centroid: [20, -20, -10] as [number, number, number],
    volumeMm3: 4100,
    vertexCount: 1200,
    faceCount: 2400,
  },
];

describe("BrainViewer Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("brain_structures.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStructures),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 404,
      } as Response);
    });
  });

  it("renders header, study metadata, and initial viewer state", async () => {
    render(<BrainViewer />);

    expect(screen.getByText("NEUROVISUALIZATION STUDIO")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Subject 0960");
    expect(screen.getByText("34 · anat-T1w")).toBeInTheDocument();
    expect(screen.getByText("Enhanced DICOM")).toBeInTheDocument();
    expect(screen.getByText("TotalSegmentator")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Viewer ready · load the structural T1 scan or 16 brain structures."
      );
    });
  });

  it("switches display palettes when preset buttons are clicked", async () => {
    render(<BrainViewer />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Viewer ready · load the structural T1 scan or 16 brain structures."
      );
    });

    const thermalButton = screen.getByRole("button", { name: /Thermal/i });
    const spectrumButton = screen.getByRole("button", { name: /Spectrum/i });
    const anatomyButton = screen.getByRole("button", { name: /Anatomy/i });

    expect(anatomyButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(thermalButton);
    expect(thermalButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Thermal palette active");

    fireEvent.click(spectrumButton);
    expect(spectrumButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Spectrum palette active");
  });

  it("switches between Linked slices and 3D volume modes", async () => {
    render(<BrainViewer />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Viewer ready · load the structural T1 scan or 16 brain structures."
      );
    });

    const renderModeBtn = screen.getByRole("button", { name: "3D volume" });
    const multiplanarModeBtn = screen.getByRole("button", { name: "Linked slices" });

    expect(multiplanarModeBtn).toHaveClass("active");

    fireEvent.click(renderModeBtn);
    expect(renderModeBtn).toHaveClass("active");

    fireEvent.click(multiplanarModeBtn);
    expect(multiplanarModeBtn).toHaveClass("active");
  });

  it("toggles the holographic gesture HUD", async () => {
    render(<BrainViewer />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Viewer ready · load the structural T1 scan or 16 brain structures."
      );
    });

    const gestureBtn = screen.getByTitle("Toggle Iron Man Holographic Gesture Control");
    expect(gestureBtn).toHaveTextContent("Holo-Gesture [OFF]");
    expect(gestureBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(gestureBtn);
    expect(gestureBtn).toHaveTextContent("Holo-Gesture [ON]");
    expect(gestureBtn).toHaveAttribute("aria-pressed", "true");

    // Click again to turn off
    fireEvent.click(gestureBtn);
    expect(gestureBtn).toHaveTextContent("Holo-Gesture [OFF]");
    expect(gestureBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("loads 16 brain structures and controls disassembly/explosion", async () => {
    render(<BrainViewer />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Viewer ready · load the structural T1 scan or 16 brain structures."
      );
      expect(screen.getByRole("button", { name: "Load 16 Structures" })).toBeEnabled();
    });

    const loadStructuresBtn = screen.getByRole("button", { name: "Load 16 Structures" });
    fireEvent.click(loadStructuresBtn);

    await waitFor(() => {
      expect(screen.getByText("ONLINE")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reload 16 Structures" })).toBeInTheDocument();
    });

    // Check disassembly slider and structure rows rendered
    expect(screen.getByText("PULL OUT")).toBeInTheDocument();
    expect(screen.getByText("Left Thalamus")).toBeInTheDocument();
    expect(screen.getByText("Left Hippocampus")).toBeInTheDocument();

    // Test structure selection toggle
    const thalamusRow = screen.getByText("Left Thalamus").closest(".structure-row");
    expect(thalamusRow).toBeInTheDocument();
    if (thalamusRow) {
      fireEvent.click(thalamusRow);
      expect(screen.getByText("HELD")).toBeInTheDocument();
      // Click again to deselect
      fireEvent.click(thalamusRow);
      expect(screen.queryByText("HELD")).not.toBeInTheDocument();
    }

    // Test Explode & Dock All pill buttons
    const explodeBtn = screen.getByRole("button", { name: "Explode" });
    const dockAllBtn = screen.getByRole("button", { name: "Dock All" });

    fireEvent.click(explodeBtn);
    expect(screen.getByText("50 mm")).toBeInTheDocument();

    fireEvent.click(dockAllBtn);
    expect(screen.getByText("0 mm")).toBeInTheDocument();
  });

  it("renders visual readout analytics cards (Signal profile and Tissue breakdown)", async () => {
    render(<BrainViewer />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Viewer ready · load the structural T1 scan or 16 brain structures."
      );
    });

    expect(screen.getByText("Signal profile")).toBeInTheDocument();
    expect(screen.getByText("Tissue mix")).toBeInTheDocument();
    expect(screen.getByText("CSF")).toBeInTheDocument();
    expect(screen.getByText("Gray matter")).toBeInTheDocument();
    expect(screen.getByText("White matter")).toBeInTheDocument();
    expect(screen.getByText("Color guide")).toBeInTheDocument();
  });
});
