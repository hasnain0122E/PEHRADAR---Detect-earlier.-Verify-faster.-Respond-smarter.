import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Camera } from "@/lib/api/types";
import {
  CAMERA_KORANGI,
  DETECTION_PENDING,
  fakeApi,
  healthyFetch,
  INCIDENT,
  INCIDENT_DETAIL,
  SCENARIO_FIRE,
  scenarioList,
  scenarioRun,
  STATION_LANDHI,
} from "@/test/fixtures";

import type { OpsMapProps } from "../map/OpsMap";
import { buildMarkers } from "../map/markers";
import { CommandCenter } from "./CommandCenter";

/** MapLibre needs WebGL; this stand-in renders the marker model and exposes the map props. */
function StubMap(props: OpsMapProps) {
  return (
    <div
      data-testid="stub-map"
      data-theme={props.theme}
      data-show-closed={String(!!props.showClosed)}
      data-route={JSON.stringify(props.route ?? null)}
    >
      {buildMarkers(props).map((m) => (
        <button key={m.key} type="button" aria-label={m.label} onClick={() => props.onSelect(m.select)}>
          {m.key}
        </button>
      ))}
    </div>
  );
}

function renderCenter(api = fakeApi()) {
  render(<CommandCenter api={api} apiBaseUrl="http://api.test" MapComponent={StubMap} fetchImpl={healthyFetch()} />);
  return api;
}

const nav = () => within(screen.getByRole("navigation", { name: "Primary" }));
const details = () => within(screen.getByRole("complementary", { name: "Details" }));

async function openSettings() {
  fireEvent.click(nav().getByRole("button", { name: "Settings" }));
  return within(await screen.findByRole("dialog", { name: "Settings" }));
}

const PAKISTAN_FEED_CAMERA: Camera = {
  ...CAMERA_KORANGI,
  stream_url: "/api/v1/media/pk_peshawar_market_street.mp4",
  feed: {
    asset: "pk_peshawar_market_street.mp4",
    title: "Market street, Peshawar",
    country: "Pakistan",
    city: "Peshawar",
    context: "Market street with pedestrians and motorcycles (daytime)",
    source_type: "pakistan_demo_footage",
    is_demo_feed: true,
    start_offset_s: 3.5,
    source_url: "https://commons.wikimedia.org/wiki/File:Example.webm",
    licence: "CC BY 3.0",
    licence_note: "CC BY 3.0, Peace Travels. Demo footage recorded in Peshawar, not at this location; not CCTV, not live.",
    attribution: "Peace Travels",
  },
};

describe("CommandCenter (M6B productization)", () => {
  it("keeps resolved incidents off the live map until the history layer is turned on", async () => {
    const resolved = { ...INCIDENT, id: "c0a80101-0000-4000-8000-0000000000ff", status: "resolved" as const };
    renderCenter(fakeApi({ listIncidents: vi.fn().mockResolvedValue([resolved]) }));
    const map = await screen.findByTestId("stub-map");
    await waitFor(() => expect(within(map).queryByLabelText(/Closed incident/)).toBeNull());
    expect(map.dataset.showClosed).toBe("false");

    const settings = await openSettings();
    fireEvent.click(settings.getByLabelText("Show resolved incidents on map"));
    expect(map.dataset.showClosed).toBe("true");
    expect(within(map).getByLabelText(/Closed incident: FIRE/)).toBeInTheDocument();
    // History stays reachable from the Incidents list either way.
  });

  it("switches the theme, map style and default view from Settings", async () => {
    renderCenter();
    const map = await screen.findByTestId("stub-map");
    expect(map.dataset.theme).toBe("light");
    const settings = await openSettings();
    fireEvent.click(within(settings.getByRole("group", { name: "Theme" })).getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(map.dataset.theme).toBe("dark"));
    expect(JSON.parse(window.localStorage.getItem("pehradar.preferences")!).theme).toBe("dark");
    fireEvent.click(within(settings.getByRole("group", { name: "Default map view" })).getByRole("button", { name: "2D" }));
    expect(JSON.parse(window.localStorage.getItem("pehradar.preferences")!).defaultView).toBe("2d");
  });

  it("runs scenarios with the delay chosen in Settings", async () => {
    const api = renderCenter();
    const settings = await openSettings();
    fireEvent.click(within(await settings.findByRole("group", { name: "Scenario delay" })).getByRole("button", { name: "5 s" }));
    fireEvent.click(settings.getByRole("button", { name: "Close settings" }));
    fireEvent.click(nav().getByRole("button", { name: "Demo" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Demo scenarios" }));
    expect(await dialog.findByText(/runs 5 s after start/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(api.startScenario).toHaveBeenCalledWith(SCENARIO_FIRE.id, { delayS: 5 }));
  });

  it("auto-starts the first fire scenario once when enabled", async () => {
    window.localStorage.setItem("pehradar.preferences", JSON.stringify({ autoStart: true, scenarioDelayS: 10 }));
    const api = renderCenter();
    await waitFor(() => expect(api.startScenario).toHaveBeenCalledWith(SCENARIO_FIRE.id, { delayS: 10 }));
    expect(api.startScenario).toHaveBeenCalledOnce();
  });

  it("full reset needs an explicit confirmation and clears temporary UI state", async () => {
    const api = renderCenter(fakeApi({ listIncidents: vi.fn().mockResolvedValue([INCIDENT]) }));
    fireEvent.click(await screen.findByRole("button", { name: /^Incident: FIRE/ }));
    expect(await details().findByText("Response facility")).toBeInTheDocument();

    const settings = await openSettings();
    fireEvent.click(settings.getByRole("button", { name: "Full reset…" }));
    const confirmBox = within(settings.getByRole("alertdialog", { name: "Confirm reset" }));
    expect(confirmBox.getByText(/Delete all operational history\?/)).toBeInTheDocument();
    expect(api.resetScenarios).not.toHaveBeenCalled();
    fireEvent.click(confirmBox.getByRole("button", { name: "Yes, delete everything" }));
    await waitFor(() => expect(api.resetScenarios).toHaveBeenCalledWith("full"));
    expect(await settings.findByText("All operational data cleared.")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });

  it("simulates node outages by zone from Settings and per camera", async () => {
    const api = renderCenter();
    const settings = await openSettings();
    fireEvent.click(settings.getByRole("button", { name: "Take offline" }));
    await waitFor(() => expect(api.setCameraStatus).toHaveBeenCalledWith({ status: "offline" }));
    fireEvent.click(settings.getByRole("button", { name: "Close settings" }));

    fireEvent.click(nav().getByRole("button", { name: /^Cameras/ }));
    const list = within(await screen.findByRole("region", { name: "Cameras" }));
    fireEvent.click(await list.findByRole("button", { name: /Korangi Industrial Area \(simulated\)/ }));
    fireEvent.click(await details().findByRole("button", { name: "Simulate offline" }));
    await waitFor(() =>
      expect(api.setCameraStatus).toHaveBeenLastCalledWith({ status: "offline", camera_ids: [CAMERA_KORANGI.id] }),
    );
  });

  it("toggles a station's demo availability", async () => {
    const api = renderCenter();
    fireEvent.click(await screen.findByRole("button", { name: /Fire station: Landhi Fire Station/ }));
    fireEvent.click(await details().findByRole("button", { name: "Mark unavailable" }));
    await waitFor(() => expect(api.setStationStatus).toHaveBeenCalledWith(STATION_LANDHI.id, "unavailable"));
  });

  it("labels Pakistan-based demo footage and shows its licence", async () => {
    renderCenter(fakeApi({ listCameras: vi.fn().mockResolvedValue([PAKISTAN_FEED_CAMERA]) }));
    fireEvent.click(nav().getByRole("button", { name: /^Cameras/ }));
    const list = within(await screen.findByRole("region", { name: "Cameras" }));
    fireEvent.click(await list.findByRole("button", { name: /Korangi Industrial Area \(simulated\)/ }));
    expect(await details().findByLabelText(/SIMULATED LIVE FEED: Korangi/)).toBeInTheDocument();
    expect(details().getByText("Pakistan-based demo footage · Peshawar")).toBeInTheDocument();
    expect(details().getByText(/Recorded in Peshawar, Pakistan, not at this location/)).toBeInTheDocument();
    expect(details().getByText("Feed source")).toBeInTheDocument();
    expect(details().getByRole("link", { name: "CC BY 3.0 · Peace Travels" })).toHaveAttribute(
      "href",
      PAKISTAN_FEED_CAMERA.feed!.source_url,
    );
  });

  it("a follow-up detection on a camera with an open incident is announced and merged", async () => {
    const followUp = { ...DETECTION_PENDING, id: "5501c1ec-0037-44d1-ba70-c441fecc4abc" };
    const pending = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([followUp]);
    const scenarios = vi
      .fn()
      .mockResolvedValueOnce(
        scenarioList([{ ...SCENARIO_FIRE, latest_run: scenarioRun({ status: "running", triggered_at: "2026-10-17T19:08:01+00:00" }) }]),
      )
      .mockResolvedValue(
        scenarioList([
          {
            ...SCENARIO_FIRE,
            latest_run: scenarioRun({ status: "detected", triggered_at: "2026-10-17T19:08:01+00:00", detection_event_id: followUp.id }),
          },
        ]),
      );
    const api = renderCenter(
      fakeApi({
        listIncidents: vi.fn().mockResolvedValue([INCIDENT]),
        listPendingDetections: pending,
        listScenarios: scenarios,
        // The API returns the open incident the detection joined (its own detection differs).
        confirmDetection: vi.fn().mockResolvedValue(INCIDENT_DETAIL),
      }),
    );
    const toasts = within(screen.getByLabelText("Alerts"));
    expect(await toasts.findByText("Additional detection, same camera", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(toasts.getByText("AI confidence 73% · incident already open")).toBeInTheDocument();

    fireEvent.click(toasts.getByRole("button", { name: "Review incident" }));
    fireEvent.click(await details().findByRole("button", { name: "Confirm incident" }));
    fireEvent.click(details().getByRole("button", { name: "Yes, confirm incident" }));
    await waitFor(() => expect(api.confirmDetection).toHaveBeenCalledWith(followUp.id));
    expect(await details().findByText("Added to the open incident from this camera. No new incident was created.")).toBeInTheDocument();
  });
});
