import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TransferQueue } from "@/components/TransferQueue";
import type { Transfer } from "@/lib/types";

const transfer: Transfer = {
  id: "t1",
  direction: "upload",
  name: "video.mp4",
  localPath: "/a/video.mp4",
  remotePath: "/uploads/",
  status: "transferring",
  bytesTransferred: 50,
  totalBytes: 100,
  speed: 1024,
  etaSeconds: 5,
};

describe("TransferQueue", () => {
  it("renders an empty state", () => {
    render(<TransferQueue transfers={[]} onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} onRetry={vi.fn()} onClearCompleted={vi.fn()} />);
    expect(screen.getByText(/Queue is empty/i)).toBeInTheDocument();
  });

  it("renders a transfer with 50% progress and fires cancel", () => {
    const onCancel = vi.fn();
    render(
      <TransferQueue transfers={[transfer]} onPause={vi.fn()} onResume={vi.fn()} onCancel={onCancel} onRetry={vi.fn()} onClearCompleted={vi.fn()} />,
    );
    expect(screen.getByText("video.mp4")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Cancel"));
    expect(onCancel).toHaveBeenCalledWith("t1");
  });
});
