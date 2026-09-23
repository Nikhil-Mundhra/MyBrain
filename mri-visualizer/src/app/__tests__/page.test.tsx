import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Home from "../page";

// Mock BrainViewer child component to verify page level rendering
vi.mock("@/components/brain-viewer", () => ({
  default: () => <div data-testid="brain-viewer-mock">Brain Viewer Component</div>,
}));

describe("Home Page", () => {
  it("renders BrainViewer component", () => {
    render(<Home />);
    expect(screen.getByTestId("brain-viewer-mock")).toBeInTheDocument();
  });
});
