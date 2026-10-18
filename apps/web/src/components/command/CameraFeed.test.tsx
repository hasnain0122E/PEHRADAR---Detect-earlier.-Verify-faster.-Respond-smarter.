import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ScenarioFeed } from "@/lib/scenarioFeed";
import { CAMERA_KORANGI, CAMERA_MAPPED, CAMERA_SADDAR } from "@/test/fixtures";

import { CameraFeed, FEED_UNAVAILABLE, feedMode } from "./CameraFeed";

const SCENARIO_CLIP: ScenarioFeed = {
  scenarioId: "korangi-industrial-fire",
  scenarioName: "Korangi industrial fire",
  videoUrl: "/api/v1/media/fire_jamestown_night.mp4",
  startAt: 12,
  footage: {
    description: "Pre-recorded fire validation footage: night building fire",
    recorded_in: "Jamestown, North Dakota, USA (2005), outside Karachi",
    source: "Tom Simpson, archive.org, CC BY-NC-SA 2.5",
  },
};

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

  it("switches a demo stream to the scenario clip with the incident label and a fixed start", () => {
    const mode = feedMode(CAMERA_KORANGI, resolve, SCENARIO_CLIP);
    expect(mode).toMatchObject({
      kind: "video",
      src: "http://api.test/api/v1/media/fire_jamestown_night.mp4",
      label: "SIMULATED INCIDENT FEED",
      note: "Pre-recorded validation footage used for this demonstration. Not a live Karachi CCTV feed.",
      startAt: 12,
      loop: true,
    });
  });

  it("plays a valid scenario clip even on a node marked offline", () => {
    expect(feedMode({ ...CAMERA_KORANGI, status: "offline" }, resolve, SCENARIO_CLIP)).toMatchObject({
      kind: "video",
      label: "SIMULATED INCIDENT FEED",
    });
  });

  it("only a public_live node is labelled public, by stream type", () => {
    const hls = { ...CAMERA_MAPPED, source_type: "public_live" as const, stream_type: "hls" as const, stream_url: "https://x/live.m3u8" };
    expect(feedMode(hls, resolve)).toMatchObject({ kind: "hls", label: "PUBLIC LIVE FEED" });
    expect(feedMode({ ...hls, stream_type: "mjpeg" }, resolve)).toMatchObject({ kind: "mjpeg" });
    // A scenario override never applies to a public stream.
    expect(feedMode(hls, resolve, SCENARIO_CLIP)).toMatchObject({ kind: "hls" });
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

  it("labels scenario footage SIMULATED INCIDENT FEED with its provenance", () => {
    render(<CameraFeed camera={CAMERA_KORANGI} mode={feedMode(CAMERA_KORANGI, resolve, SCENARIO_CLIP)} />);
    const video = screen.getByLabelText(/SIMULATED INCIDENT FEED: Korangi/) as HTMLVideoElement;
    expect(video.src).toBe("http://api.test/api/v1/media/fire_jamestown_night.mp4");
    expect(video.muted && video.loop && video.autoplay).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();
    expect(screen.getByText("SIMULATED INCIDENT FEED")).toBeInTheDocument();
    expect(screen.getByText("Pre-recorded validation footage used for this demonstration. Not a live Karachi CCTV feed.")).toBeInTheDocument();
    expect(screen.getByText("Korangi industrial fire")).toBeInTheDocument();
    expect(screen.getByText(/Recorded in Jamestown, North Dakota, USA \(2005\), outside Karachi/)).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Pause feed" })).toBeInTheDocument();
  });

  it("offers a Play button when the browser blocks autoplay", async () => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
    try {
      render(<CameraFeed camera={CAMERA_KORANGI} mode={feedMode(CAMERA_KORANGI, resolve, SCENARIO_CLIP)} />);
      expect(await screen.findByRole("button", { name: "Play feed" })).toBeInTheDocument();
    } finally {
      HTMLMediaElement.prototype.play = original;
    }
  });

  it("lets the operator retry a feed that failed to load", () => {
    render(<CameraFeed camera={CAMERA_KORANGI} mode={feedMode(CAMERA_KORANGI, resolve, SCENARIO_CLIP)} />);
    fireEvent.error(screen.getByLabelText(/SIMULATED INCIDENT FEED/));
    expect(screen.getByText("Feed could not be loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry feed" }));
    expect(screen.getByLabelText(/SIMULATED INCIDENT FEED/).tagName).toBe("VIDEO");
  });

  it("renders the unavailable state without any video", () => {
    const { container } = render(<CameraFeed camera={CAMERA_SADDAR} mode={feedMode(CAMERA_SADDAR, resolve)} />);
    expect(screen.getByText(/Feed unavailable in hackathon environment/)).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });
});
