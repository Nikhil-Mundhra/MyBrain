import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BrainViewer from "../brain-viewer";

const mockStructures = [
  {
    id: "thalamus_left",
    label: "Left Thalamus",
    category: "Sensory Relay Hub",
    color: "#28d7ff",
    description: "Crucial sensory relay station routing signals to cerebral cortex.",
    meshFile: "/models/brain-structures/thalamus_left.obj",
    centroid: [-12, -18, 6] as [number, number, number],
    volumeMm3: 8293.8,
    vertexCount: 270,
    faceCount: 504,
  },
  {
    id: "hippocampus_left",
    label: "Left Hippocampus",
    category: "Memory & Navigation",
    color: "#bcf34b",
    description: "Critical for consolidation of short-term memory to long-term memory.",
    meshFile: "/models/brain-structures/hippocampus_left.obj",
    centroid: [-25, -22, -12] as [number, number, number],
    volumeMm3: 4210.5,
    vertexCount: 270,
    faceCount: 504,
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

  it("renders header, study metadata, and initial spatial stage state", async () => {
    render(<BrainViewer />);

    expect(screen.getByText("SPATIAL NEURO")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Subject 0960");
    expect(screen.getByText("anat-T1w · 34")).toBeInTheDocument();
    expect(screen.getByText("FreeSurfer Ground Truth")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("Left Thalamus")[0]).toBeInTheDocument();
    });
  });

  it("switches display colormap presets when palette chips are clicked", async () => {
    render(<BrainViewer />);

    const thermalButton = screen.getByRole("button", { name: /Thermal/i });
    const perceptualButton = screen.getByRole("button", { name: /Perceptual/i });
    const anatomyButton = screen.getByRole("button", { name: /Anatomy/i });

    expect(anatomyButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(thermalButton);
    await waitFor(() => {
      expect(thermalButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/Thermal colormap applied/i)).toBeInTheDocument();
    });

    fireEvent.click(perceptualButton);
    await waitFor(() => {
      expect(perceptualButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/Perceptual colormap applied/i)).toBeInTheDocument();
    });
  });

  it("switches between 3D Structures, Glass Cranium, and Linked Slices stage modes", async () => {
    render(<BrainViewer />);

    const structuresTab = screen.getByRole("tab", { name: "3D Structures" });
    const glassTab = screen.getByRole("tab", { name: "Glass Cranium" });
    const slicesTab = screen.getByRole("tab", { name: "Linked Slices" });

    expect(structuresTab).toHaveClass("active");

    fireEvent.click(glassTab);
    expect(glassTab).toHaveClass("active");

    fireEvent.click(slicesTab);
    expect(slicesTab).toHaveClass("active");
  });

  it("toggles the spatial gesture HUD", async () => {
    render(<BrainViewer />);

    const gestureBtn = screen.getByTitle("Toggle Spatial Gesture Camera HUD");
    expect(gestureBtn).toHaveTextContent("Enable Gesture HUD");
    expect(gestureBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(gestureBtn);
    expect(gestureBtn).toHaveTextContent("Gesture Tracking Active");
    expect(gestureBtn).toHaveAttribute("aria-pressed", "true");

    // Click again to turn off
    fireEvent.click(gestureBtn);
    expect(gestureBtn).toHaveTextContent("Enable Gesture HUD");
    expect(gestureBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("inspects brain structures and controls disassembly/explosion", async () => {
    render(<BrainViewer />);

    await waitFor(() => {
      expect(screen.getAllByText("Left Thalamus")[0]).toBeInTheDocument();
      expect(screen.getAllByText("Left Hippocampus")[0]).toBeInTheDocument();
    });

    // Test structure selection and detail inspection
    const thalamusItem = screen.getAllByText("Left Thalamus")[0];
    fireEvent.click(thalamusItem);

    // Inspector card should be populated
    expect(screen.getByText("Sensory Relay Hub")).toBeInTheDocument();
    expect(screen.getByText("8.29 cm³")).toBeInTheDocument();
    expect(screen.getByText("Crucial sensory relay station routing signals to cerebral cortex.")).toBeInTheDocument();

    // Test radial explosion buttons
    const explodeBtn = screen.getByRole("button", { name: "Explode 45mm" });
    const dockAllBtn = screen.getByRole("button", { name: "Dock Core" });

    fireEvent.click(explodeBtn);
    expect(screen.getByText("45 mm")).toBeInTheDocument();

    fireEvent.click(dockAllBtn);
    expect(screen.getByText("0 mm")).toBeInTheDocument();
  });
});
