"use client";

import { PRODUCT_NAME } from "@/lib/config";

import { Icon, type IconName } from "../icons";
import { FOCUS } from "./ui";

/** Workspace views. "monitor" is the quiet map; the others open a list panel over it. */
export type NavView = "overview" | "monitor" | "incidents" | "cameras" | "stations";

const ITEMS: { id: NavView; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "monitor", label: "Monitor", icon: "map" },
  { id: "incidents", label: "Incidents", icon: "alert" },
  { id: "cameras", label: "Cameras", icon: "camera" },
  { id: "stations", label: "Stations", icon: "station" },
];

const ITEM = `relative grid w-14 justify-items-center gap-1 rounded-lg py-2 text-xs font-medium transition-colors ${FOCUS}`;
const itemState = (active: boolean) => (active ? "bg-muted text-fg" : "text-fg-2 hover:bg-muted hover:text-fg");

export function NavRail({
  view,
  onView,
  attention,
  urgent,
  demoActive,
  onDemo,
  onSettings,
}: {
  view: NavView;
  onView: (view: NavView) => void;
  /** Pending detections + active incidents: shown as a count on Incidents. */
  attention: number;
  /** An active incident exists (badge turns red instead of amber). */
  urgent: boolean;
  demoActive: boolean;
  onDemo: () => void;
  onSettings: () => void;
}) {
  return (
    <nav aria-label="Primary" className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3">
      <div className="mb-3 grid justify-items-center gap-1" title="Detect earlier. Verify faster. Respond smarter.">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-white">
          <Icon name="radar" size={20} />
        </span>
        <span className="text-xs font-semibold tracking-tight">{PRODUCT_NAME}</span>
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={view === item.id ? "page" : undefined}
          onClick={() => onView(item.id)}
          className={`${ITEM} ${itemState(view === item.id)}`}
        >
          <Icon name={item.icon} size={20} />
          {item.label}
          {item.id === "incidents" && attention > 0 && (
            <span
              aria-label={`${attention} need attention`}
              className={`absolute top-1 right-2 min-w-[18px] rounded-full px-1 text-center text-[11px] leading-[18px] font-semibold text-white ${
                urgent ? "bg-fire" : "bg-warn"
              }`}
            >
              {attention}
            </span>
          )}
        </button>
      ))}
      <button type="button" onClick={onDemo} className={`${ITEM} ${itemState(false)}`}>
        <Icon name="play" size={20} />
        Demo
        {demoActive && <span aria-hidden className="absolute top-2 right-3 h-2 w-2 animate-pulse rounded-full bg-info" />}
      </button>
      <div className="flex-1" />
      <button type="button" onClick={onSettings} className={`${ITEM} ${itemState(false)}`}>
        <Icon name="settings" size={20} />
        Settings
      </button>
    </nav>
  );
}
