'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const library = require('./');
const { parsePqdif } = library;
const { inflateSync } = require('node:zlib');
const librarySource = fs.readFileSync(path.join(__dirname, 'lib/pqdif.js'), 'utf8');
const fixture = path.join(__dirname, '..', '40-6084 PQDIFExport_Utility S 10kV-v1.pqd');
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'pqdif_data.json'), 'utf8'));
const bytes = fs.readFileSync(fixture);

// Compare the serialized public API with the C# JSON contract.
const actual = JSON.parse(JSON.stringify(parsePqdif(bytes)));

test('complete JavaScript export equals C# reference, including every sample and metadata field', () => {
  assert.deepStrictEqual(actual, expected);
  assert.equal(actual.observations.length, 29);
  const channels = actual.observations.flatMap(o => o.channels);
  assert.equal(channels.length, 1094);
  assert.equal(channels.flatMap(c => c.series).reduce((sum, s) => sum + s.count, 0), 2555804);
});

test('invalid and truncated input fails instead of returning a misleading empty result', () => {
  assert.throws(() => parsePqdif(Buffer.alloc(64)), /signature/);
  assert.throws(() => parsePqdif(bytes.subarray(0, 63)), /Truncated/);
  assert.throws(() => parsePqdif(bytes.subarray(0, bytes.length - 100)), /record size/);
});

test('viewer loads the shared library, prepares every observation, and exports matching JSON', async () => {
  // Exercise the inline UI using small DOM/Chart doubles; no CDN or browser is
  // required for this regression test. Chart pixel rendering is not tested.
  const charts = [];
  let downloadedBlob, downloadName;
  function node() {
    return { style: {}, classList: { add() {}, remove() {} }, value: '0', children: [],
      innerHTML: '', setAttribute() {}, appendChild(child) { this.children.push(child); }, addEventListener() {}, querySelector: node, remove() {},
      click() { if (this.download) downloadName = this.download; } };
  }
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    createElement: node
  };
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<script src="\.\/lib\/pqdif\.js"><\/script>/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({ document, ArrayBuffer, Uint8Array, DataView,
    pako: { inflate: inflateSync }, Blob, console,
    URL: { createObjectURL(blob) { downloadedBlob = blob; return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout(callback) { callback(); },
    file: { name: path.basename(fixture), async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } },
    Chart: class {
    constructor(canvas, config) {
      assert.ok(config.data.datasets.length);
      for (const dataset of config.data.datasets) {
        assert.ok(dataset.data.length);
        assert.ok(dataset.data.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
      }
      this.config = config;
      this.options = config.options;
      this.scales = { x: { min: config.options.scales.x.min, max: config.options.scales.x.max } };
      charts.push(this);
    }
    update(mode) { this.updateMode = mode; }
    destroy() { this.destroyed = true; }
  }});
  vm.runInContext(librarySource, context);
  vm.runInContext(script, context);
  await vm.runInContext('loadFile(file)', context);
  assert.equal(document.getElementById('controls').style.display, 'flex');
  assert.match(document.getElementById('meta').textContent, /29 observations/);
  assert.equal(document.getElementById('chartType').value, 'level-time', 'Level Time Diagram is the default analysis');
  assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(LOGICAL)', context)), expected);
  for (const type of ['trend', 'osc', 'harmonics', 'level-time', 'itic']) {
    document.getElementById('chartType').value = type;
    const priorChartCount = charts.length;
    vm.runInContext('updateAnalysisView()', context);
    if (type === 'itic') {
      const eventCharts = charts.slice(priorChartCount);
      assert.equal(eventCharts.length, 1, 'ITIC should render one voltage-duration diagram');
      assert.deepStrictEqual(Array.from(eventCharts[0].config.data.datasets, dataset => dataset.label), ['Upper limit', 'Lower limit']);
    }
    if (type === 'level-time') {
      const levelTimeCharts = charts.slice(priorChartCount);
      assert.equal(levelTimeCharts.length, 1, 'Level Time Diagram should render one frequency chart');
      const frequencyDatasets = levelTimeCharts[0].config.data.datasets;
      assert.deepStrictEqual(Array.from(frequencyDatasets, dataset => dataset.label), ['f', 'f min', 'f max']);
      assert.ok(frequencyDatasets.every(dataset => dataset.data.length === 1009),
        'Level Time Diagram should show the complete 7-day recording at 10-minute cadence');
      assert.ok(frequencyDatasets.every(dataset =>
        dataset.data.at(-1).x - dataset.data[0].x >= 7 * 24 * 60 * 60 * 1000),
        'Level Time Diagram should retain the full recording date range');
      assert.ok(frequencyDatasets.every(dataset => dataset.data.every(point => point.y !== 0)),
        'empty zero-only frequency data should not be shown as a measurement');
    }
  }
  document.getElementById('chartType').value = 'level-time';
  document.getElementById('levelMeasurement').value = 'voltage';
  const voltageStart = charts.length;
  vm.runInContext('updateAnalysisView()', context);
  const voltageCharts = charts.slice(voltageStart).map(chart => chart.config);
  assert.equal(voltageCharts.length, 5, 'separate RMS, extremes, and extra voltage channels');
  assert.ok(voltageCharts.every(chart => chart.options.scales.y.title.text === 'Voltage (V)'));
  assert.deepStrictEqual(voltageCharts.map(chart => chart.data.datasets.length), [4, 3, 8, 6, 3]);
  const voltageChart = { data: { datasets: voltageCharts.flatMap(chart => chart.data.datasets) } };
  const voltageObservation = expected.observations.find(o => o.name.startsWith('Steady State Voltage RMS'));
  const voltageChannels = voltageObservation.channels.filter(c => c.series.some(s => s.units === 'Volts'));
  assert.equal(voltageChart.data.datasets.length, 24);
  for (const channel of voltageChannels) {
    for (const series of channel.series.filter(s => s.units === 'Volts')) {
      const label = `${channel.name} · ${library.seriesValueTypeNames[series.valueType]}`;
      const dataset = voltageChart.data.datasets.find(d => d.label === label);
      assert.ok(dataset, label);
      assert.deepStrictEqual(Array.from(dataset.data, p => p.y), series.values);
      assert.equal(dataset.data[1].x - dataset.data[0].x, 600000);
    }
  }
  const zoomSource = charts[voltageStart];
  zoomSource.scales.x = { min: voltageChart.data.datasets[0].data[2].x,
    max: voltageChart.data.datasets[0].data[8].x };
  zoomSource.options.plugins.zoom.zoom.onZoom({ chart: zoomSource });
  for (const chart of charts.slice(voltageStart + 1)) {
    assert.equal(chart.options.scales.x.min, zoomSource.scales.x.min);
    assert.equal(chart.options.scales.x.max, zoomSource.scales.x.max);
    assert.equal(chart.updateMode, 'none');
  }
  const end = voltageChart.data.datasets[0].data.at(-1).x;
  vm.runInContext(`document.getElementById('rangeStart').value = localDateInputValue(${end - 3600000})`, context);
  vm.runInContext('updateAnalysisView()', context);
  assert.ok(charts.at(-1).config.data.datasets.every(d => d.data.length === 7),
    'Voltage date filter must clip every line to the selected hour');
  vm.runInContext('resetDataRange()', context);
  for (const [key, count, points] of [
    ['pst', 3, 1009], ['plt', 3, 84], ['thd', 24, 1009],
    ['odd', 4, 1009], ['even', 4, 1009], ['harmonic', 4, 1009],
    ['inter', 2, 1009], ['unbalance', 2, 1009], ['components', 3, 1009]
  ]) {
    document.getElementById('levelMeasurement').value = key;
    const start = charts.length;
    vm.runInContext('updateAnalysisView()', context);
    const datasets = charts.slice(start).flatMap(chart => Array.from(chart.config.data.datasets));
    assert.equal(datasets.length, count, key);
    for (const dataset of datasets) {
      const [, oi, ci, si] = dataset.sourceId.match(/^o(\d+)-c(\d+)-s(\d+)$/).map(Number);
      const channel = expected.observations[oi].channels[ci];
      assert.equal(dataset.data.length, points, key);
      assert.deepStrictEqual(Array.from(dataset.data, p => p.y), channel.series[si].values, dataset.sourceId);
      if (key === 'odd' || key === 'even') {
        assert.equal(Number(channel.instance.channelGroupID), key === 'odd' ? 3 : 2);
      }
      if (key === 'plt') assert.equal(dataset.data[1].x - dataset.data[0].x, 7200000);
    }
    if (key === 'odd') {
      document.getElementById('levelSubset').value = 'Group 5';
      vm.runInContext('updateAnalysisView()', context);
      assert.ok(charts.at(-1).config.data.datasets.every(d => d.label.includes('group 5')));
    }
  }
  for (const key of ['angle', 'pwhd', 'supra', 'signal', 'signal-ext', 'prevailing', 'thd-ext', 'harmonic-ext', 'flicker-ext']) {
    document.getElementById('levelMeasurement').value = key;
    const start = charts.length;
    vm.runInContext('updateAnalysisView()', context);
    assert.equal(charts.length, start, key + ' must not fabricate unavailable measurements');
    assert.match(document.getElementById('charts').textContent, /no matching measurements/);
  }
  assert.match(document.getElementById('eventSummary').textContent, /events/);
  const routing = vm.runInContext(`(() => {
    const item = { channel: { quantityTypeName: 'WaveForm', name: 'Voltage', series: [] },
      series: { values: [1, NaN, 3] } };
    const points = seriesPoints(item, 'osc');
    return [matchesChart(item, 'osc'), matchesChart(item, 'trend'), matchesChart(item, 'harmonics'),
      points.axis, points.points.map(p => p.x)];
  })()`, context);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(routing)), [true, true, false, 'Sample index', [0, 2]]);
  assert.equal(vm.runInContext("matchesChart({channel:{quantityTypeName:'Response',name:'Spectrum'}}, 'harmonics')", context), true);
  assert.equal(vm.runInContext("matchesChart({channel:{quantityTypeName:'ValueLog',name:'Voltage THD'}}, 'harmonics')", context), true);
  assert.ok(charts.length > 0);
  assert.equal(charts[0].destroyed, true);
  vm.runInContext('downloadJson()', context);
  assert.equal(downloadName, 'pqdif_data.json');
  assert.deepStrictEqual(JSON.parse(await downloadedBlob.text()), expected);
});


test('Node package entry and existing CLI entry expose the same library', () => {
  assert.strictEqual(require('./pqdif.cjs'), library);
  assert.equal(typeof library.PqdifParser, 'function');
  assert.throws(() => parsePqdif('not binary'), /Expected an ArrayBuffer/);
  assert.throws(() => parsePqdif(null), /Expected an ArrayBuffer/);
});

test('browser library reports missing decompression support and accepts an injected inflater', () => {
  const context = vm.createContext({ ArrayBuffer, Uint8Array, DataView });
  vm.runInContext(librarySource, context);
  assert.throws(() => context.Pqdif.parsePqdif(bytes), /require pako/);
  // Include padding to verify that typed-array byte offsets are respected.
  const padded = Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(9)]);
  const result = context.Pqdif.parsePqdif(padded.subarray(7, 7 + bytes.length), inflateSync);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), expected);
});
