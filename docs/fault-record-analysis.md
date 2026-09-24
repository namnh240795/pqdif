# Fault Record analysis — WebPQ inspection

Inspected 24 September 2026 in the authenticated [WebPQ demo](https://demo-webpq.powerquality.cloud/index.html#/analysis/1dutsUd), including Basic settings and the [Fault records view](https://demo-webpq.powerquality.cloud/index.html#/fault-recorder). This is an implementation reference, not a claim that every device exposes the same fields.

## Basic settings: observed

- Analysis Type: **Fault Record**.
- Start/end absolute date and time, including milliseconds; displayed timezone and Edit Time Interval control.
- Device selector with clear and device-tree controls. Inspected device: **magnet1 (PQI-LV)**.
- **Fault records +/-10 Minutes** table: selection checkboxes, Type, Time, Device, Trigger, search, and pagination.
- OSC and TRMS appear as separate selectable records, even for the same trigger.
- **Data Class & Types** is a selectable hierarchy with Edit and Clear Selection.
- **Apply** loads the preview. AutoSync can apply changes immediately; inspected state was Off. Save in and Cancel are separate actions.

Example selected OSC trigger: 23/09/2026 21:44:17.7596435, Africa/Johannesburg, `Undervoltage U12 -> active`. Its corresponding TRMS timestamp is 21:44:17.7596270. Another OSC/TRMS pair at 21:44:06.352… has `Undervoltage U1E -> active`.

The selected recording spans approximately 21:44:17.659643–21:44:18.349485: about 690 ms, with approximately 100 ms before the trigger. Recording length is not automatically the duration of the voltage disturbance.

### Selected OSC channels

| Group | Channels | Units |
|---|---|---|
| Voltage → Line-Earth Voltage | UL1N, UL2N, UL3N | V |
| Voltage → Line-Line Voltage | UL12, UL23, UL31 | V |
| Current → Line Current | IL1, IL2, IL3, IN | A |

The picker also exposes an unselected UNE voltage channel, Insulation measurement and Other groups. Its broader data-class list includes Osc, TRMS, Bin (Binary Inputs), Harm (Harmonic recorder), RMSOnline, periodic intervals and Modbus Master. Presence in this generic picker does **not** establish that this particular fault record contains those datasets.

## Loaded OSC diagram: observed

Apply successfully loaded real data despite intermittent unrelated device/server error notifications.

- Three vertically aligned panels: line-earth voltage, line-line voltage, current.
- Colored continuous waveform lines; shared time axis. The preview uses relative millisecond ticks around the trigger, with absolute start/end times and timezone above it.
- Device and trigger descriptions appear in the title, with an explicit triggered-at timestamp.
- Legend grouped by record/device/data class/quantity/unit; per-channel visibility controls.
- Accessibility reported 988 displayed points per actual channel. It reported 23 total series including auxiliary/group series; this does not mean 23 measured channels or establish the raw sample count.
- Min/max summary beneath the chart, grouped by UCLE, UCLL, INOM. Each group has channel, Min, %, Max, %; absent values display `-`.
- Example UL1N: minimum −336.5 V (−103.5%), maximum 341.82 V (105.1%). IL1: −434.74 A (−51.2%) to 360.97 A (42.5%). These are signed waveform extrema, not RMS minima.
- A Duration row is present but displayed `-` for the inspected OSC record. Percentage reference calculations were not independently verified.

## Additional controls: observed, partly unverified

- Eval Board exposes Information, Marker, Extremes, Threshold and FFT Options sections.
- Marker instructs the user to set a marker by clicking the chart.
- Show/Hide FFT Analysis opens an additional area titled FFT Spectrum. FFT Options includes Time Window Mode with **Flexible Window (Zoomable)** selected.
- Exact FFT normalization, window choices, spectrum output, tooltip contents, marker calculations and synchronization of zoom between panels still need direct verification. Do not infer them from the control labels.
- A TRMS record is available, but its chart rendering and complete channel hierarchy were not inspected in this pass.

## Mapping to our PQDIF sample

Verified against `PqdReader/pqdif_data.json`, the existing parsed output for `40-6084 PQDIFExport_Utility S 10kV-v1.pqd`:

- Seven Event observations: six SagSwell records and one Transient record, on 6–7 September 2024.
- Each SagSwell record contains eight `SS_RMS_*` channels and eight `SS_WF_*` channels: U1–U4 and I1–I4 in each family.
- The Transient record contains eight `TR_WF_*` waveform channels: U1–U4 and I1–I4.
- WF channels are typed WaveForm; the supplied RMS channels are typed Phasor. Preserve their exported series interpretation rather than reclassifying all Phasor quantities as RMS.
- These event observations have `triggerMethod: Channel`, but `timeTriggered` is the invalid sentinel `0001-01-01T00:00:00.0000000`. Do not fabricate an exact trigger marker from observation start.

### Proposed implementation

1. Add Fault Record as a separate analysis type and list event observations by their actual dates, names and available WF/RMS families.
2. On record selection, fit the time range to that recording's actual sample timestamps. Use the long-term latest-four-hour default only for long-term analyses.
3. Offer separate OSC/WF and RMS views, with available voltage/current channel checkboxes. Keep U and I in aligned panels and RMS separate from waveform.
4. Render recorded channels first. Our event channel names do not include explicit line-line voltage channels. Any U12/U23/U31 derived from phase waveforms must be labeled derived and require matching timestamps and confirmed phase metadata. Never obtain line-line RMS by subtracting scalar phase RMS values.
5. Calculate signed waveform min/max and supplied RMS min/max independently. Show percentage only with a verified nominal reference appropriate to that series. Missing trigger metadata, reference values or disturbance duration should show unavailable.
6. Preserve source U4/I4 labels until phase metadata confirms whether each is neutral/residual; do not assume a mapping solely from its index.
7. Add legend toggles, zoom/reset and timestamp/value inspection. FFT can follow once sampling/window/normalization behavior is specified and tested.

The sample has the waveform and RMS event data needed for a similar Fault Record viewer. Exact WebPQ trigger text, nominal percentages and every device-specific channel cannot be promised from this export. The implementation follow-up below describes the subsequently added analysis types.


## TRMS follow-up and implementation

The loaded TRMS preview was inspected on 24 September 2026. Its Basic settings selects TRMS (TRMS-recorder), with F [Hz], UL1N/UL2N/UL3N/UNE [V], U12/U23/U31 [V], and IL1/IL2/IL3/IN [A]. Four stacked time-aligned panels display frequency, line-earth voltage, line-line voltage and current. The inspected span is 21:44:15.276163–21:44:25.529940, with trigger at 21:44:17.759627. The x axis displays milliseconds relative to that trigger. RMS traces show the sag envelope rather than oscillating waveforms. Example UL1N minimum is 42.64 V (18.5%), maximum 253.9 V (110.4%).

`index.html` now offers Fault Record and TRMS in Analysis Type. Fault Record allows WF/RMS selection; TRMS restricts the picker to RMS-capable events. Both fit the selected recording, offer channel checkboxes, use all recorded samples, provide aligned time bounds with synchronized x zoom/pan, and show per-series min/max statistics. The fixture supplies seven WF records and six RMS records, each with four U and four I channels. No event frequency or explicit line-line channels are invented. Without a valid trigger timestamp the x axis is explicitly relative to the displayed recording start, not a claimed trigger. FFT and nominal-percent calculations remain outside this implementation.

Validation: the existing Node/DOM viewer test now switches to both new analysis types, checks record counts and U/I panel separation, and compares every plotted value for the first recording to the parsed fixture. It is not a browser pixel-rendering test.
