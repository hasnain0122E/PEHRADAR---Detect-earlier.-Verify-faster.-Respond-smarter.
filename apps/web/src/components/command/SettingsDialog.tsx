"use client";

import { type ReactNode, useState } from "react";

import type { ResetScope } from "@/lib/api/types";
import { DELAY_CHOICES, type Preferences, type Theme } from "@/lib/preferences";

import { Icon, type IconName } from "../icons";
import type { Sound } from "./TopBar";
import { BUTTON_DANGER, BUTTON_SECONDARY, FOCUS, InlineError, Modal } from "./ui";
import { describeError } from "./useOpsData";

const SEGMENT = `inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors ${FOCUS}`;

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${SEGMENT} ${value === o.value ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg"}`}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {hint && <span className="text-[13px] text-fg-2">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-4 w-4 shrink-0 accent-navy"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-medium tracking-wide text-fg-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}

export interface SettingsDialogProps {
  sound: Sound;
  prefs: Preferences;
  onPrefs: (patch: Partial<Preferences>) => void;
  zones: string[];
  scenariosEnabled: boolean;
  onNodes: (status: "active" | "offline", district: string | null) => Promise<number>;
  onReset: (scope: ResetScope) => Promise<unknown>;
  onClose: () => void;
}

/** Compact console settings (M6B): appearance, alerts, demo pacing, network simulation, resets. */
export function SettingsDialog(props: SettingsDialogProps) {
  const { sound, prefs, onPrefs } = props;
  const [zone, setZone] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<ResetScope | null>(null);

  async function perform(key: string, action: () => Promise<string>) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (err) {
      setError(describeError(err, "The action failed"));
    } finally {
      setBusy(null);
      setArmed(null);
    }
  }

  const nodes = (status: "active" | "offline") =>
    perform(`nodes-${status}`, async () => {
      const changed = await props.onNodes(status, zone || null);
      const where = zone ? `in ${zone}` : "in the network";
      return `${changed} node${changed === 1 ? "" : "s"} ${where} ${status === "offline" ? "taken offline" : "back online"} (simulation).`;
    });

  return (
    <Modal title="Settings" onClose={props.onClose} width="max-w-[520px]">
      <Section title="Appearance">
        <Row title="Theme">
          <Segmented<Theme>
            label="Theme"
            value={prefs.theme}
            onChange={(theme) => onPrefs({ theme })}
            options={[
              { value: "light", label: "Light", icon: "sun" },
              { value: "dark", label: "Dark", icon: "moon" },
              { value: "system", label: "System", icon: "monitor" },
            ]}
          />
        </Row>
        <Row title="Default map view" hint="Used when the console opens.">
          <Segmented<"2d" | "3d">
            label="Default map view"
            value={prefs.defaultView}
            onChange={(defaultView) => onPrefs({ defaultView })}
            options={[
              { value: "2d", label: "2D" },
              { value: "3d", label: "3D" },
            ]}
          />
        </Row>
        <Row title="Show resolved incidents on map" hint="History layer; the live map shows only open incidents.">
          <Toggle label="Show resolved incidents on map" checked={prefs.showResolved} onChange={(showResolved) => onPrefs({ showResolved })} />
        </Row>
      </Section>

      <Section title="Alerts">
        {sound.supported ? (
          <Row title="Alert sound" hint="Chime when a new detection or incident arrives.">
            <Toggle label="Alert sound" checked={sound.enabled} onChange={(on) => (on ? sound.enable() : sound.disable())} />
          </Row>
        ) : (
          <p className="text-[13px] text-fg-2">This browser cannot play the alert sound.</p>
        )}
      </Section>

      <Section title="Demo scenarios">
        {props.scenariosEnabled ? (
          <>
            <Row title="Auto-start a scenario" hint="Arms the first fire scenario when the console opens.">
              <Toggle label="Auto-start a scenario" checked={prefs.autoStart} onChange={(autoStart) => onPrefs({ autoStart })} />
            </Row>
            <Row title="Scenario delay" hint="Seconds before the detector runs on the clip.">
              <Segmented<string>
                label="Scenario delay"
                value={String(prefs.scenarioDelayS)}
                onChange={(v) => onPrefs({ scenarioDelayS: Number(v) })}
                options={DELAY_CHOICES.map((d) => ({ value: String(d), label: `${d} s` }))}
              />
            </Row>
          </>
        ) : (
          <p className="text-[13px] text-fg-2">Demo scenarios are disabled on this API (SCENARIOS_ENABLED).</p>
        )}
      </Section>

      <Section title="Network simulation">
        <p className="text-[13px] text-fg-2">
          Take simulated nodes offline to rehearse an outage. It changes demo status only; no real camera exists.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Nodes to change</span>
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className={`h-9 appearance-none rounded-lg border border-line bg-surface pr-8 pl-3 text-[13px] font-medium text-fg ${FOCUS}`}
            >
              <option value="">All nodes</option>
              {props.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} className="pointer-events-none absolute top-2.5 right-2.5 text-fg-2" />
          </label>
          <button type="button" className={BUTTON_SECONDARY} disabled={busy !== null} onClick={() => void nodes("offline")}>
            <Icon name="power" size={16} />
            {busy === "nodes-offline" ? "Updating…" : "Take offline"}
          </button>
          <button type="button" className={BUTTON_SECONDARY} disabled={busy !== null} onClick={() => void nodes("active")}>
            <Icon name="check" size={16} />
            {busy === "nodes-active" ? "Updating…" : "Bring online"}
          </button>
        </div>
      </Section>

      <Section title="Reset">
        {armed === null ? (
          <div className="grid gap-3">
            <Row title="Reset operations" hint="Cancels demo runs, closes demo alerts and incidents, clears the map. History is kept.">
              <button
                type="button"
                className={`${BUTTON_SECONDARY} shrink-0`}
                disabled={busy !== null || !props.scenariosEnabled}
                onClick={() => setArmed("demo")}
              >
                <Icon name="reset" size={16} />
                Reset operations
              </button>
            </Row>
            <Row title="Full reset" hint="Deletes every detection, incident and run; restores all nodes and stations.">
              <button
                type="button"
                className={`${BUTTON_SECONDARY} shrink-0 text-fire-ink`}
                disabled={busy !== null || !props.scenariosEnabled}
                onClick={() => setArmed("full")}
              >
                Full reset…
              </button>
            </Row>
          </div>
        ) : (
          <div role="alertdialog" aria-label="Confirm reset" className="grid gap-3 rounded-lg bg-muted p-4">
            <p className="text-[13px] text-fg">
              {armed === "full" ? (
                <>
                  <strong className="font-semibold">Delete all operational history?</strong> Every detection, incident,
                  timeline and scenario run is removed. Cameras, stations and demo feeds stay. This cannot be undone.
                </>
              ) : (
                "Close all demo-generated alerts and incidents? Nothing is deleted; closed incidents stay in history."
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setArmed(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={armed === "full" ? BUTTON_DANGER : BUTTON_SECONDARY}
                disabled={busy !== null}
                onClick={() =>
                  void perform(`reset-${armed}`, async () => {
                    await props.onReset(armed);
                    return armed === "full" ? "All operational data cleared." : "Operations reset. The live map is clear.";
                  })
                }
              >
                {busy?.startsWith("reset") ? "Resetting…" : armed === "full" ? "Yes, delete everything" : "Yes, reset operations"}
              </button>
            </div>
          </div>
        )}
      </Section>

      {(message || error) && (
        <div aria-live="polite">{error ? <InlineError>{error}</InlineError> : <p className="text-[13px] text-ok-ink">{message}</p>}</div>
      )}

      <Section title="About this demo environment">
        <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-fg-2">
          <li>Simulated monitoring network with demo footage. No official or Safe City CCTV is connected.</li>
          <li>Pakistan-based demo feeds are licensed recordings looped as SIMULATED LIVE FEED, not live streams.</li>
          <li>The AI is decision support only. An operator confirms every incident.</li>
          <li>No notification or dispatch is sent. Not connected to any emergency service.</li>
          <li>Station availability is demonstration data. The candidate station is chosen by straight-line distance.</li>
          <li>Stations and roads © OpenStreetMap contributors (ODbL), unverified. Routes by OSRM, estimates only.</li>
        </ul>
      </Section>
    </Modal>
  );
}
