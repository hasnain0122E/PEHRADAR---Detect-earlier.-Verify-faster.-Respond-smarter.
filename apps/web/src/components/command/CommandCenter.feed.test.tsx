import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fakeApi, healthyFetch, SCENARIO_FIRE, scenarioList, scenarioRun } from "@/test/fixtures";

import type { OpsMapProps } from "../map/OpsMap";
import { CommandCenter } from "./CommandCenter";

const StubMap: (props: OpsMapProps) => React.JSX.Element = () => <div data-testid="stub-map" />;

describe("scenario camera feed (final hotfix)", () => {
  it("plays the scenario clip on its camera while it runs and restores the normal feed on reset", async () => {
    const korangi = {
      ...SCENARIO_FIRE,
      video_url: "/api/v1/media/fire_jamestown_night.mp4",
      feed_start_s: 12,
      footage: { description: "Pre-recorded fire validation footage", recorded_in: "Jamestown, ND, USA, outside Karachi", source: "archive.org" },
      latest_run: scenarioRun({ status: "scheduled", created_at: new Date().toISOString() }),
    };
    const api = fakeApi({ listScenarios: vi.fn().mockResolvedValue(scenarioList([korangi])) });
    render(<CommandCenter api={api} apiBaseUrl="http://api.test" MapComponent={StubMap} fetchImpl={healthyFetch()} />);

    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", { name: /^Cameras/ }));
    const list = within(await screen.findByRole("region", { name: "Cameras" }));
    fireEvent.click(await list.findByRole("button", { name: /Korangi Industrial Area \(simulated\)/ }));
    const details = within(screen.getByRole("complementary", { name: "Details" }));

    const video = (await details.findByLabelText(/SIMULATED INCIDENT FEED: Korangi/)) as HTMLVideoElement;
    expect(video.src).toBe("http://api.test/api/v1/media/fire_jamestown_night.mp4");
    expect(details.getByText(/Not a live Karachi CCTV feed/)).toBeInTheDocument();
    expect(details.queryByText(/Camera offline/)).toBeNull();

    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", { name: "Demo" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Demo scenarios" }));
    fireEvent.click(dialog.getByRole("button", { name: "Reset operations" }));
    fireEvent.click(dialog.getByRole("button", { name: "Yes, reset operations" }));
    await waitFor(() => expect(api.resetScenarios).toHaveBeenCalledWith("demo"));
    fireEvent.click(dialog.getByRole("button", { name: "Close demo scenarios" }));

    const normal = (await details.findByLabelText(/SIMULATED LIVE FEED: Korangi/)) as HTMLVideoElement;
    expect(normal.src).toBe("http://api.test/api/v1/media/street_sunset_traffic.mp4");
  });
});
