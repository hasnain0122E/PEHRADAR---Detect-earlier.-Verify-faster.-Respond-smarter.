import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  CAMERA_KORANGI,
  DETECTION_PENDING,
  fakeApi,
  healthyFetch,
  INCIDENT,
  INCIDENT_DETAIL,
  NEGATIVE_RESULT,
  POSITIVE_RESULT,
  ROUTE_OK,
  SCENARIO_FIRE,
  scenarioList,
  scenarioRun,
} from "@/test/fixtures";

import type { OpsMapProps } from "../map/OpsMap";
import { buildMarkers } from "../map/markers";
import { CommandCenter } from "./CommandCenter";

/** MapLibre needs WebGL; this stand-in renders the same marker model as plain buttons. */
function StubMap(props: OpsMapProps) {
  return (
    <div
      data-testid="stub-map"
      data-route={JSON.stringify(props.routes ?? null)}
      data-focus={props.focus?.key ?? ""}
      data-view={props.view}
    >
      {buildMarkers(props).map((m) => (
        <button key={m.key} type="button" aria-label={m.label} data-classes={m.className} onClick={() => props.onSelect(m.select)}>
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

function clipFile(name = "pos_fire.mp4", size = 1000) {
  return new File([new Uint8Array(size)], name, { type: "video/mp4" });
}

const details = () => within(screen.getByRole("complementary", { name: "Details" }));
const nav = () => within(screen.getByRole("navigation", { name: "Primary" }));
const statusStrip = () => screen.getByLabelText("City status");

/** Opens a list panel from the navigation rail (Overview, Incidents, Cameras, Stations). */
async function openList(name: "Overview" | "Incidents" | "Cameras" | "Stations") {
  fireEvent.click(nav().getByRole("button", { name: new RegExp(`^${name}`) }));
  return within(await screen.findByRole("region", { name }));
}

async function openKorangi() {
  const list = await openList("Cameras");
  fireEvent.click(await list.findByRole("button", { name: /Korangi Industrial Area \(simulated\)/ }));
  return screen.findByRole("button", { name: "Analyze test footage" });
}

async function openPendingReview() {
  const list = await openList("Incidents");
  fireEvent.click(await list.findByRole("button", { name: /Korangi Industrial Area \(simulated\).*awaiting review/ }));
}

describe("CommandCenter", () => {
  it("starts on a quiet map: no drawer and no list until something is selected", async () => {
    renderCenter();
    await waitFor(() => expect(statusStrip()).toHaveTextContent(/Monitoring nodes\s*2/));
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Cameras" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Demo scenarios" })).toBeNull();
    expect(await screen.findByText("System online")).toBeInTheDocument();
  });

  it("renders cameras, stations and incidents from the API", async () => {
    renderCenter(fakeApi({ listIncidents: vi.fn().mockResolvedValue([INCIDENT]) }));

    const list = await openList("Cameras");
    expect(await list.findByText("Saddar - Empress Market (simulated)")).toBeInTheDocument();
    const map = screen.getByTestId("stub-map");
    expect(within(map).getByLabelText(/Fire station: Landhi Fire Station \(available, demo flag/)).toBeInTheDocument();
    expect(within(map).getByLabelText(/Fire station: Orangi Fire Station \(unavailable/)).toBeInTheDocument();
    expect(within(map).getByLabelText(/Incident: FIRE, HIGH severity, Station selected/)).toBeInTheDocument();
    // Camera with an active incident is marked on the map and in the status strip.
    expect(within(map).getByLabelText(/Camera: Korangi.*active incident/)).toBeInTheDocument();
    await waitFor(() => expect(statusStrip()).toHaveTextContent(/Active incidents\s*1/));
    expect(nav().getByRole("button", { name: /^Incidents\s*1 need attention/ })).toBeInTheDocument();
  });

  it("selecting a camera opens its details and the footage action", async () => {
    renderCenter();
    const analyze = await openKorangi();

    expect(screen.getByRole("heading", { name: "Korangi Industrial Area (simulated)" })).toBeInTheDocument();
    expect(details().getAllByText("KHI-CAM-03").length).toBeGreaterThan(0);
    expect(details().getByLabelText(/SIMULATED LIVE FEED: Korangi/)).toBeInTheDocument();
    expect(analyze).toBeDisabled(); // no clip chosen yet
    const map = screen.getByTestId("stub-map");
    expect(within(map).getByLabelText(/Camera: Korangi/).dataset.classes).toContain("is-selected");

    fireEvent.click(details().getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });

  it("rejects an oversized or non-MP4 clip before upload", async () => {
    const api = renderCenter();
    await openKorangi();
    const input = screen.getByLabelText("Video clip (.mp4)");

    fireEvent.change(input, { target: { files: [clipFile("clip.mov")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an .mp4 file.");
    fireEvent.change(input, { target: { files: [clipFile("big.mp4", 5 * 1024 * 1024)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("The demo limit is 4.0 MB");
    expect(screen.getByRole("button", { name: "Analyze test footage" })).toBeDisabled();
    expect(api.analyzeFootage).not.toHaveBeenCalled();
  });

  it("shows a positive result as an evidence review", async () => {
    let finish: (value: typeof POSITIVE_RESULT) => void = () => {};
    const api = renderCenter(
      fakeApi({
        analyzeFootage: vi.fn().mockImplementation(
          (_id, _file, options) =>
            new Promise((resolve) => {
              options?.onUploaded?.();
              finish = resolve;
            }),
        ),
      }),
    );
    await openKorangi();
    fireEvent.change(screen.getByLabelText("Video clip (.mp4)"), { target: { files: [clipFile()] } });
    expect(screen.getByText("pos_fire.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyze test footage" }));

    // Processing stages, without a fabricated percentage for the server-side part.
    expect(await screen.findByText(/Evaluating temporal consistency/)).toBeInTheDocument();
    expect(screen.getByText(/reports no partial progress/)).toBeInTheDocument();
    expect(api.analyzeFootage).toHaveBeenCalledWith(CAMERA_KORANGI.id, expect.any(File), expect.anything());

    finish(POSITIVE_RESULT);
    expect(await screen.findByText("Fire detected")).toBeInTheDocument();
    expect(screen.getByLabelText("FIRE")).toBeInTheDocument();
    expect(screen.getByText("73%")).toBeInTheDocument(); // primary metric
    expect(screen.getByText("38 of 57 sampled")).toBeInTheDocument();
    expect(screen.getByText("00:18.7 into the clip")).toBeInTheDocument();
    expect(screen.getByText("Persistent fire activity detected across consecutive sampled frames.")).toBeInTheDocument();
    expect(screen.getByText(/Automated detection can be wrong/)).toBeInTheDocument();
    // Model internals stay behind "Detection details".
    expect(screen.getByText("Detection details").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(POSITIVE_RESULT.rule)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", `http://api.test${DETECTION_PENDING.evidence_url}`);
  });

  it("shows a negative result without implying safety", async () => {
    const api = renderCenter();
    await openKorangi();
    fireEvent.change(screen.getByLabelText("Video clip (.mp4)"), { target: { files: [clipFile("street.mp4")] } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze test footage" }));

    expect(await screen.findByText("No persistent fire or smoke detected.")).toBeInTheDocument();
    expect(screen.getByText("This does not confirm the location is safe.")).toBeInTheDocument();
    expect(screen.getByText(String(NEGATIVE_RESULT.sampled_frames))).toBeInTheDocument();
    expect(screen.getByText("14.5 s")).toBeInTheDocument();
    expect(screen.getByText("0.52")).toBeInTheDocument(); // peak model confidence
    expect(api.confirmDetection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Analyse another clip" }));
    expect(screen.getByRole("button", { name: "Analyze test footage" })).toBeInTheDocument();
  });

  it("confirms a detection once and opens the incident with its candidate station", async () => {
    let resolveConfirm: (v: typeof INCIDENT_DETAIL) => void = () => {};
    const api = fakeApi({
      listPendingDetections: vi.fn().mockResolvedValue([DETECTION_PENDING]),
      confirmDetection: vi.fn().mockImplementation(() => new Promise((r) => (resolveConfirm = r))),
    });
    renderCenter(api);
    await openPendingReview();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm incident" }));
    expect(screen.getByText(/No one is notified or dispatched/)).toBeInTheDocument();
    const yes = screen.getByRole("button", { name: "Yes, confirm incident" });
    fireEvent.click(yes);
    fireEvent.click(screen.getByRole("button", { name: "Confirming…" }));
    expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
    expect(api.confirmDetection).toHaveBeenCalledTimes(1);

    resolveConfirm(INCIDENT_DETAIL);
    expect(await screen.findByText(/Incident created. Landhi Fire Station suggested. No dispatch was sent./)).toBeInTheDocument();
    expect(details().getByText("Fire incident")).toBeInTheDocument();
    expect(details().getByText("Landhi Fire Station")).toBeInTheDocument();
    expect(screen.getByText("Suggested response resources based on mapped proximity and routing estimates. This does not confirm real-world availability or dispatch.")).toBeInTheDocument();
    expect(details().getByText("Station selected")).toBeInTheDocument(); // status chip
    expect(details().getByText("Fire station selected")).toBeInTheDocument(); // timeline
    await waitFor(() => expect(api.listIncidents).toHaveBeenCalledTimes(2)); // refreshed after the action
  });

  it("rejects a detection without creating an incident", async () => {
    const api = fakeApi({ listPendingDetections: vi.fn().mockResolvedValue([DETECTION_PENDING]) });
    renderCenter(api);
    await openPendingReview();

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "sunset glare" } });
    fireEvent.click(screen.getByRole("button", { name: "Yes, reject detection" }));

    expect(await screen.findByText("Detection rejected. No incident was created.")).toBeInTheDocument();
    expect(api.rejectDetection).toHaveBeenCalledWith(DETECTION_PENDING.id, { note: "sunset glare" });
    expect(api.confirmDetection).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirm incident" })).not.toBeInTheDocument();
  });

  it("explains an already-reviewed detection and links its incident", async () => {
    const api = fakeApi({
      listPendingDetections: vi.fn().mockResolvedValue([DETECTION_PENDING]),
      confirmDetection: vi.fn().mockRejectedValue(
        new ApiError("http", "Detection was already confirmed", 409, "DETECTION_ALREADY_REVIEWED", {
          incident_id: INCIDENT.id,
        }),
      ),
    });
    renderCenter(api);
    await openPendingReview();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm incident" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, confirm incident" }));

    expect(await screen.findByText(/already reviewed, possibly from another console/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the incident" }));
    expect(await screen.findByText("Suggested response")).toBeInTheDocument();
  });

  it("selecting an incident shows its detail and timeline", async () => {
    const api = fakeApi({ listIncidents: vi.fn().mockResolvedValue([INCIDENT]) });
    renderCenter(api);
    const list = await openList("Incidents");
    fireEvent.click(await list.findByRole("button", { name: /Suggested: Landhi Fire Station/ }));

    expect(await details().findByText("Timeline")).toBeInTheDocument();
    expect(api.getIncident).toHaveBeenCalledWith(INCIDENT.id, expect.anything());
    for (const label of ["Detected", "Confirmed", "Fire station selected"]) {
      expect(details().getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Notified")).not.toBeInTheDocument(); // only states that happened
    // An incident without a stored road route shows the straight-line fallback for that unit.
    expect(screen.getByText(/Road route unavailable; [\d.]+ km straight-line/)).toBeInTheDocument();
    const map = screen.getByTestId("stub-map");
    expect(within(map).getByLabelText(/Landhi.*suggested fire resource/).dataset.classes).toContain("is-candidate");
  });

  it("shows an error state with retry when operational data cannot load", async () => {
    const listIncidents = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("network", "Cannot reach the API (offline, wrong URL, or CORS blocked)"))
      .mockResolvedValue([]);
    renderCenter(fakeApi({ listIncidents }));

    expect(await screen.findByText(/Operational data could not be loaded: Cannot reach the API/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument());
    await waitFor(() => expect(statusStrip()).toHaveTextContent(/Monitoring nodes\s*2/));
  });

  it("reports an upload failure from the operator proxy", async () => {
    renderCenter(
      fakeApi({
        analyzeFootage: vi
          .fn()
          .mockRejectedValue(new ApiError("unauthorized", "Missing or invalid X-Operator-Key header", 401, "UNAUTHORIZED")),
      }),
    );
    await openKorangi();
    fireEvent.change(screen.getByLabelText("Video clip (.mp4)"), { target: { files: [clipFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze test footage" }));

    expect(await screen.findByText(/Analysis of pos_fire.mp4 failed: Missing or invalid X-Operator-Key/)).toBeInTheDocument();
  });

  it("switches the map between 2D and 3D from the top bar", async () => {
    renderCenter();
    const map = screen.getByTestId("stub-map");
    expect(map.dataset.view).toBe("3d");
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(map.dataset.view).toBe("2d");
    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "true");
  });

  it("frames a zone on the map when one is chosen", async () => {
    renderCenter();
    const zone = await screen.findByRole("combobox", { name: "Zone" });
    await waitFor(() => expect(within(zone).getByRole("option", { name: "Korangi" })).toBeInTheDocument());
    fireEvent.change(zone, { target: { value: "Korangi" } });
    expect(screen.getByTestId("stub-map").dataset.focus).toMatch(/^zone:Korangi:/);
  });
});

describe("CommandCenter (M5 automated monitoring)", () => {
  const scenarioDetection = {
    ...DETECTION_PENDING,
    details: {
      ...DETECTION_PENDING.details,
      source: {
        kind: "scenario" as const,
        scenario_id: SCENARIO_FIRE.id,
        scenario_run_id: "9a8b7c6d-0000-4000-8000-00000000aa01",
        video_asset: "fire_jamestown_night.mp4",
      },
    },
  };
  const running = scenarioRun({ status: "running", triggered_at: "2026-10-17T19:08:01+00:00" });
  const detected = scenarioRun({
    status: "detected",
    triggered_at: "2026-10-17T19:08:01+00:00",
    completed_at: "2026-10-17T19:08:15+00:00",
    detection_event_id: DETECTION_PENDING.id,
  });

  it("raises an alert from a scenario detection without any operator action", async () => {
    const pending = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([scenarioDetection]);
    const scenarios = vi
      .fn()
      .mockResolvedValueOnce(scenarioList([{ ...SCENARIO_FIRE, latest_run: running }]))
      .mockResolvedValue(scenarioList([{ ...SCENARIO_FIRE, latest_run: detected }]));
    const api = renderCenter(fakeApi({ listPendingDetections: pending, listScenarios: scenarios }));

    // The run finishes on the next scenario poll (about 2 s); that reloads detections at once.
    const toasts = within(screen.getByLabelText("Alerts"));
    expect(await toasts.findByText("Possible fire detected", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(toasts.getByText("Korangi Industrial Area")).toBeInTheDocument();
    expect(toasts.getByText("AI confidence 73%")).toBeInTheDocument();
    expect(api.analyzeFootage).not.toHaveBeenCalled();
    expect(api.confirmDetection).not.toHaveBeenCalled(); // never auto-confirmed
    const map = screen.getByTestId("stub-map");
    expect(within(map).getByLabelText(/Camera: Korangi.*1 detection awaiting review/).dataset.classes).toContain("is-pending");
    expect(map.dataset.focus).toBe(DETECTION_PENDING.id); // the map flies to the alert
    expect(nav().getByRole("button", { name: /^Incidents\s*1 need attention/ })).toBeInTheDocument();
    expect(statusStrip()).toHaveTextContent(/Pending alerts\s*1/);
    // Only the notification appears: no panel opens by itself.
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();

    fireEvent.click(toasts.getByRole("button", { name: "Review incident" }));

    expect(await details().findByText("Fire detected")).toBeInTheDocument();
    expect(details().getByLabelText(/SIMULATED LIVE FEED: Korangi/)).toBeInTheDocument();
    expect(details().getByText(/Automated demo scenario “Korangi industrial fire”/)).toBeInTheDocument();
    expect(details().getByRole("button", { name: "Confirm incident" })).toBeInTheDocument();
    expect(details().getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByText("Possible fire detected")).toBeNull(); // the toast is consumed
  }, 10000);

  it("shows the suggested road route on demand and draws it on the map", async () => {
    const withRoute = { ...INCIDENT_DETAIL, route: ROUTE_OK };
    renderCenter(
      fakeApi({
        listPendingDetections: vi.fn().mockResolvedValue([scenarioDetection]),
        confirmDetection: vi.fn().mockResolvedValue(withRoute),
        getIncident: vi.fn().mockResolvedValue(withRoute),
      }),
    );
    await openPendingReview();
    fireEvent.click(await details().findByRole("button", { name: "Confirm incident" }));
    fireEvent.click(details().getByRole("button", { name: "Yes, confirm incident" }));

    expect(await details().findByText("Suggested response")).toBeInTheDocument();
    expect(details().getByText("9.1 km")).toBeInTheDocument();
    expect(details().getByText("11 min")).toBeInTheDocument();
    expect(details().getByText("Suggested response resources based on mapped proximity and routing estimates. This does not confirm real-world availability or dispatch.")).toBeInTheDocument();
    expect(details().queryByText(/dispatched/i)).toBeNull();
    expect(JSON.parse(screen.getByTestId("stub-map").dataset.route!)).toBeNull(); // not until asked

    fireEvent.click(details().getByRole("button", { name: "Show route" }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("stub-map").dataset.route!)).toEqual([
        { unit: "fire", color: "#E5484D", coordinates: ROUTE_OK.geometry!.coordinates },
      ]),
    );
    const summary = within(screen.getByLabelText("Route summary"));
    expect(summary.getByText("Landhi Fire Station")).toBeInTheDocument();
    expect(summary.getByText("Road estimate · not a dispatch")).toBeInTheDocument();

    fireEvent.click(summary.getByRole("button", { name: "Exit route view" }));
    expect(JSON.parse(screen.getByTestId("stub-map").dataset.route!)).toBeNull();
    expect(screen.queryByLabelText("Route summary")).toBeNull();
  });

  it("runs a scenario and resets the demo from the demo dialog", async () => {
    const api = renderCenter();
    fireEvent.click(nav().getByRole("button", { name: "Demo" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Demo scenarios" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(api.startScenario).toHaveBeenCalledWith(SCENARIO_FIRE.id, { delayS: 5 }));
    // The dialog closes: the scenario now runs on its own.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Demo scenarios" })).toBeNull());

    fireEvent.click(nav().getByRole("button", { name: "Demo" }));
    const again = within(await screen.findByRole("dialog", { name: "Demo scenarios" }));
    fireEvent.click(again.getByRole("button", { name: "Reset operations" }));
    expect(api.resetScenarios).not.toHaveBeenCalled(); // two-step
    const loadsBefore = vi.mocked(api.listIncidents).mock.calls.length;
    fireEvent.click(again.getByRole("button", { name: "Yes, reset operations" }));
    await waitFor(() => expect(api.resetScenarios).toHaveBeenCalledWith("demo"));
    // Closed scenario incidents show at once, not at the next 10 s poll.
    await waitFor(() => expect(vi.mocked(api.listIncidents).mock.calls.length).toBeGreaterThan(loadsBefore));
  });

  it("shows city status counts computed from the API data", async () => {
    renderCenter(fakeApi({ listIncidents: vi.fn().mockResolvedValue([INCIDENT]) }));
    await waitFor(() => expect(statusStrip()).toHaveTextContent(/Monitoring nodes\s*2/));
    expect(statusStrip()).toHaveTextContent(/Online\s*2/);
    expect(statusStrip()).toHaveTextContent(/Active incidents\s*1/);
    expect(statusStrip()).toHaveTextContent(/Response facilities\s*1\/2/);
  });

  it("a camera without a stream shows the unavailable state and its provenance", async () => {
    renderCenter();
    const list = await openList("Cameras");
    fireEvent.click(await list.findByRole("button", { name: /Saddar - Empress Market/ }));
    expect(await details().findByText(/Feed unavailable in hackathon environment: simulated coverage node/)).toBeInTheDocument();
    expect(details().getByText("Simulated coverage node")).toBeInTheDocument();
  });

  it("lists items needing attention in the overview", async () => {
    renderCenter(fakeApi({ listPendingDetections: vi.fn().mockResolvedValue([DETECTION_PENDING]) }));
    const overview = await openList("Overview");
    expect(await overview.findByText("Needs attention")).toBeInTheDocument();
    fireEvent.click(overview.getByRole("button", { name: /Korangi Industrial Area \(simulated\).*awaiting review/ }));
    expect(await details().findByText("Fire detected")).toBeInTheDocument();
  });
});
