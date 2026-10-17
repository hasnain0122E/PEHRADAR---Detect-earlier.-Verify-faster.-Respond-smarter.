import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CAMERA_KORANGI, CAMERA_MAPPED, CAMERA_SADDAR } from "@/test/fixtures";

import { CameraFeed, FEED_UNAVAILABLE, feedMode } from "./CameraFeed";

const resolve = (url: string | null) => (url ? (url.startsWith("/") ? `http://api.test${url}` : url) : null);

describe("feedMode", () => {
  it("plays a demo stream as a looping video labelled simulated", () => {
    expect(feedMode(CAMERA_KORANGI, resolve)).toMatchObject({
      kind: "video",
      loop: true,
      src: "http://api.test/api/v1/media/street_sunset_traffic.mp4",
      label: "SIMULATED LIVE FEED",
    });
  });

  it("switches a demo stream to the scenario clip", () => {
    const mode = feedMode(CAMERA_KORANGI, resolve, { src: "http://api.test/fire.mp4", note: "Scenario clip" });
    expect(mode).toMatchObject({ kind: "video", src: "http://api.test/fire.mp4", label: "SIMULATED LIVE FEED" });
  });

  it("only a public_live node is labelled public, by stream type", () => {
    const hls = { ...CAMERA_MAPPED, source_type: "public_live" as const, stream_type: "hls" as const, stream_url: "https://x/live.m3u8" };
    expect(feedMode(hls, resolve)).toMatchObject({ kind: "hls", label: "PUBLIC LIVE FEED" });
    expect(feedMode({ ...hls, stream_type: "mjpeg" }, resolve)).toMatchObject({ kind: "mjpeg" });
    // A scenario override never applies to a public stream.
    expect(feedMode(hls, resolve, { src: "http://api.test/fire.mp4", note: "" })).toMatchObject({ kind: "hls" });
  });

  it("explains why simulated, mapped or offline nodes have no feed", () => {
    expect(feedMode(CAMERA_SADDAR, resolve)).toEqual({
      kind: "none",
      reason: `${FEED_UNAVAILABLE}: simulated coverage node`,
    });
    expect(feedMode(CAMERA_MAPPED, resolve)).toMatchObject({ reason: expect.stringContaining("mapped location only") });
    expect(feedMode({ ...CAMERA_KORANGI, status: "offline" }, resolve)).toEqual({ kind: "none", reason: "Camera offline" });
  });
});

describe("CameraFeed", () => {
  it("renders a muted looping video with the simulated label", () => {
    render(<CameraFeed camera={CAMERA_KORANGI} mode={feedMode(CAMERA_KORANGI, resolve)} />);
    const video = screen.getByLabelText(/SIMULATED LIVE FEED: Korangi/) as HTMLVideoElement;
    expect(video.tagName).toBe("VIDEO");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(screen.getByText(/Not Karachi CCTV/)).toBeInTheDocument();
    expect(screen.queryByText(/PUBLIC LIVE FEED/)).toBeNull();
  });

  it("renders the unavailable state without any video", () => {
    const { container } = render(<CameraFeed camera={CAMERA_SADDAR} mode={feedMode(CAMERA_SADDAR, resolve)} />);
    expect(screen.getByText(/Feed unavailable in hackathon environment/)).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });
});
