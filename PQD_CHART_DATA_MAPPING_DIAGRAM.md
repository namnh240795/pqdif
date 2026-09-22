# PQDIF file-to-chart mapping

Based on `PQD_CHART_DATA_MAPPING (1).md`. This describes the architecture in that document; it does not assert that its Python backend and SVG frontend exist in this repository. Live Modbus/Q200 register charts, COMTRADE, CSV, and PDF are outside this flow.

## Data flow and chart routing

```mermaid
flowchart TD
    File["Imported .pqd file bytes"] --> Physical["Physical decoding<br/>parse_pqdif_bytes()<br/>backend/pqdif/physical.py"]
    Physical --> Semantic["Semantic mapping and normalization<br/>analyze_pqdif()<br/>backend/pqdif/semantic.py"]
    Semantic --> Raw["series.rawValues<br/>Retained source data"]
    Semantic --> Values["analysis.observations[o].channels[c].series[s].values<br/>Normalized numeric samples"]
    Semantic --> Catalog["analysis.seriesCatalog<br/>Metadata and IDs only — no duplicate sample arrays<br/>Example: o0-c1-s0"]
    Semantic --> Events["Observation duration<br/>Channel characterization magnitude"]

    Catalog --> Eligible{"count > 1 and<br/>normalizationApplied === true?"}
    Eligible -->|No| Excluded["Not eligible for sample charts<br/>Includes unnormalized increment-encoded series"]
    Eligible -->|Yes| Selection["Chart-specific source selection"]
    Selection --> Trend["Trend: select a non-Time series<br/>pqdifTrendPanel()"]
    Selection --> Osc["OSC: select a Waveform series<br/>pqdifOscPanel(analysis, 'osc')"]
    Selection --> Harmonics["Harmonics: first eligible Response series<br/>or channel/quantity name containing<br/>harmonic, thd, or interharm<br/>pqdifHarmonicsPanel()"]

    Trend --> Resolve["Resolve selected o#-c#-s# ID<br/>to its original series entry"]
    Osc --> Resolve
    Harmonics --> Resolve
    Values --> Resolve
    Resolve -->|Trend and OSC| Line["svgPqdifSeries(series.values, ...)<br/>Ignore non-finite values<br/>Downsample displays above 1,800 finite points<br/>Keep original parsed arrays unchanged"]
    Resolve -->|Harmonics| Bars["svgPqdifBars(series.values, ...)<br/>X: stored array index<br/>Y: normalized value with unit<br/>Do not infer harmonic order"]

    Events --> EventCheck{"Finite duration > 0<br/>and finite magnitude?"}
    EventCheck -->|Yes| Itic["Magnitude–Duration / ITIC<br/>pqdifIticPanel()<br/>X: Number(observation.duration)<br/>Y: Number(channel.characterizationMagnitude)"]
    EventCheck -->|No| Omit["Omit point"]

    classDef source fill:#dbeafe,stroke:#2563eb,color:#172554;
    classDef chart fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef excluded fill:#f1f5f9,stroke:#64748b,color:#334155;
    class File,Raw,Values,Catalog,Events source;
    class Line,Bars,Itic chart;
    class Excluded,Omit excluded;
```

Scaling occurs in the semantic layer when the storage method requires it: `value = raw × scale + offset`. In the supplied document, increment-encoded series are retained raw and are not plotted. ITIC uses event metadata rather than `series.values`. OSC applies no additional RMS calculation, scaling, filtering, or waveform reconstruction beyond the renderer's finite-value filtering and display-only downsampling.

## Trend and OSC time-axis fallback

```mermaid
flowchart TD
    Start["pqdifTimeAxis()<br/>For the selected Trend or OSC series"] --> Time{"Usable Time series in the same channel<br/>with matching sample count?<br/>valueType = Time or unit = timestamp"}
    Time -->|Yes| UseTime["Use the channel's Time series"]
    Time -->|No| Filename{"Q200 filename timestamp<br/>plus a parsed metadata cadence?"}
    Filename -->|Yes| UseFilename["Use filename start time + cadence<br/>Filename pattern: _YYYYMMDDThhmmss..."]
    Filename -->|No| Observation{"Observation timeStart or timeCreate<br/>plus a parsed metadata cadence?"}
    Observation -->|Yes| UseObservation["Use observation start/create time + cadence"]
    Observation -->|No| Index["Use sample index<br/>sample 0 through final sample"]
    UseTime --> Labels["Time-axis labels only<br/>Numeric sample values remain unchanged"]
    UseFilename --> Labels
    UseObservation --> Labels
    Index --> Labels
```

Cadence examples from the document include `Freq10s` and `10min`. The first usable source wins.

## Fixture examples reported by the document

These values are reported for `tests/fixtures/MES_Q200_SYNTHETIC_TEST.pqd`; they have not been independently verified here.

| Chart | Selected source | ID | Samples | Unit | Parsed range |
| --- | --- | --- | ---: | --- | --- |
| Trend | Ua 10min | `o0-c0-s0` | 36 | V | 228.8000–230.1968 |
| Harmonics | Ua Harmonics | `o0-c1-s0` | 25 | % | 0.04–100.0 |
| OSC | Ua Waveform | `o0-c2-s0` | 256 | V | -325.0–325.0 |
