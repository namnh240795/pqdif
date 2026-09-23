# Historical analysis viewer

Open `PqdReader/index.html` and load the supplied `.pqd` recording. The parser contract remains identical to the C# JSON reference.

- **Trend:** select multiple historical ValueLog channels; dates display day/month/year and local time. Start/end filter actual sample timestamps. Measurement families and units have separate panels. Rendering reduces lines above 1,800 points; original samples remain intact.
- **Harmonics:** grouped columns for U1/U2/U3 and I1/I2/I3, separated into voltage/current panels. Choose a recorded timestamp. For this particular export, channel-group IDs identify orders 0–50; sample-array positions are times, not harmonic orders. This export-specific mapping is not a universal PQDIF convention.
- **THD Voltage Trend:** defaults to THDF U1/U2/U3; other stored THD channels are selectable.
- **Histogram:** one channel, user-selected bin width in its recorded unit, [lower, upper) bins aligned to zero. Every finite sample is counted before rendering. Includes empty bins. Rejects more than 20,000 bins instead of silently changing resolution.
- **Scatter:** choose X/Y channels (defaults to PTot/QTot), swap axes, inspect values and timestamp on hover. Only identical timestamps are paired; no interpolation. At most 20,000 points are displayed, with total and display counts shown.
- **ITIC:** only available when event observations are present. Recorded voltage MagDur/MagDurTime Values + Duration + positive nominalQuantity enable markers. The RMS envelope covers durations ≥20 ms; shorter events are marked unassessed. Outside markers are red crosses. This reference is not a certification of a 10 kV network.
- **Event detail / COMTRADE:** click an event row or marker to inspect its PQDIF waveform/RMS. Associate an explicit matching `.cfg` + `.dat` pair with the selected event to open COMTRADE instead. CFG revisions 1999/2013 and ASCII/BINARY/BINARY32/FLOAT32 analog records are supported. Calibration uses a×raw+b in recorded units; no primary/secondary conversion. Digital inputs are skipped. Dates are interpreted in the displayed local timezone; explicit COMTRADE 2013 timezone metadata is not currently applied. Associations are in memory and cleared on loading another PQDIF.

## Reference inspection

On 23 September 2026, inspected [WebPQ Analysis Cockpit](https://demo-webpq.powerquality.cloud/index.html#/analysis/1dutsUd), device eladewest:

- Analysis menu exposes Level Time Diagram, Histogram, Scatter Plot, Voltage and current harmonics, ITIC and other views.
- Histogram uses only the first selected channel and “Resolution in Measure Unit” (minimum 0.00001). Applying 1 V bins to 10-minute u1 showed six columns at 232–237 V, with counts 31, 192, 274, 270, 235, 6. X is voltage; Y is Amount.
- Scatter exposes active power X/reactive power Y, configurable groups, swap axes, bounds, colour and shape controls. This local implementation covers channel selection, swapping, value axes and dated hover; it does not reproduce every style control.
- Switching/applying the harmonic preview encountered repeated browser timeouts. Do not treat its exact appearance as visually verified.

The supplied file has 29 observations, harmonic time histories and event waveform/RMS records, but lacks suitable MagDur magnitude/duration/nominal characterization and any associated COMTRADE pair. Its ITIC view therefore does not fabricate markers. The source recording is September 2024, so demo-site September 2026 values/dates must not replace its data.

Reference documents: [Socomec ITIC envelope, Figure 1](https://www.socomec.co.uk/sites/default/files/2025-04/UNDERSTANDING-STS_TECHNICAL-NOTE_2025-04-17-11-00-13_DOT60013i_English_PLURI.pdf), [SEL COMTRADE example](https://selinc.com/api/download/120353).

## Verification

`node --test PqdReader/pqdif.test.cjs` checks full C# parity, source harmonic values, selected channels, dated axes, histogram count conservation including one million samples, timestamp pairing, missing ITIC metadata, synthetic envelope classification and calibrated COMTRADE formats/truncation.

The browser automation policy blocks the local `file://` page. Automated tests use DOM/Chart doubles and do not verify canvas pixels or mouse interaction.
