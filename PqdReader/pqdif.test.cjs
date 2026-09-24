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
      get options() { return this.children; }, get selectedOptions() { return this.children.filter(c => c.value === this.value); },
      get innerHTML() { return ''; }, set innerHTML(value) { this.children = []; },
      append(...children) { this.children.push(...children); }, setAttribute() {}, appendChild(child) { this.children.push(child); }, addEventListener() {}, querySelector: node, remove() {},
      click() { if (this.download) downloadName = this.download; } };
  }
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    createTextNode(text) { return {textContent:text}; },
    querySelectorAll() { return elements.get("faultChannels").children.flatMap(label => label.children).filter(input => input.checked); },
    createElement: node
  };
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<script src="\.\/lib\/pqdif\.js"><\/script>/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({ document, ArrayBuffer, Uint8Array, DataView, TextDecoder,
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
  const initialEnd = new Date(document.getElementById('rangeEnd').value).getTime();
  vm.runInContext(`document.getElementById('rangeStart').value = localDateInputValue(${initialEnd - 14 * 24 * 60 * 60 * 1000}); updateAnalysisView('start')`, context);
  assert.equal(new Date(document.getElementById('rangeEnd').value).getTime() -
    new Date(document.getElementById('rangeStart').value).getTime(), 7 * 24 * 60 * 60 * 1000,
  'changing the start date limits the visible window to seven days');
  vm.runInContext('resetDataRange()', context);
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
  for (const [type, prefix, count] of [['fault-record','SS_WF_',7], ['trms','SS_RMS_',6]]) {
    const mode = document.getElementById('faultMode');
    mode.children = ['WaveForm','RMS'].map(value => ({value}));
    document.getElementById('chartType').value = type;
    const first = charts.length;
    vm.runInContext('updateAnalysisView()', context);
    assert.equal(document.getElementById('faultRecord').options.length, count);
    const faultCharts = charts.slice(first);
    assert.equal(faultCharts.length, 2, 'recorded voltage and current get separate panels');
    const datasets = faultCharts.flatMap(chart => chart.config.data.datasets);
    assert.equal(datasets.length, 8);
    assert.ok(datasets.every(d => d.label.startsWith(prefix)));
    const record = expected.observations[20];
    for (const dataset of datasets) {
      const channel = record.channels.find(c => dataset.label.startsWith(c.name + ' ·'));
      const source = channel.series.find(s => ['Volts','Amps'].includes(s.units));
      assert.deepStrictEqual(Array.from(dataset.data, p => p.y), source.values);
    }
    assert.equal(faultCharts[0].options.scales.x.min, faultCharts[1].options.scales.x.min);
    assert.equal(faultCharts[0].options.scales.x.max, faultCharts[1].options.scales.x.max);
  }
  document.getElementById('faultMode').children = ['WaveForm', 'RMS', 'combined'].map(value => ({value}));
  document.getElementById('chartType').value = 'fault-record';
  vm.runInContext('updateAnalysisView()', context);
  document.getElementById('faultMode').value = 'combined';
  const combinedStart = charts.length;
  vm.runInContext('updateFaultChannels(); renderCharts()', context);
  const combinedCharts = charts.slice(combinedStart);
  assert.equal(combinedCharts.length, 4, 'combined fault view stacks voltage/current waveform and RMS panels');
  assert.deepStrictEqual(combinedCharts.map(chart => chart.config.data.datasets.length), [4, 4, 4, 4]);
  document.getElementById('chartType').value = 'level-time';
  vm.runInContext('resetDataRange()', context);
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
  assert.deepStrictEqual(JSON.parse(JSON.stringify(routing)), [true, false, false, 'Sample index', [0, 2]]);
  assert.equal(vm.runInContext("matchesChart({channel:{quantityTypeName:'Response',name:'Spectrum'}}, 'harmonics')", context), false);
  assert.equal(vm.runInContext("matchesChart({channel:{quantityTypeName:'ValueLog',name:'Voltage THD'}}, 'harmonics')", context), false);
  // Historical analyses use real fixture values and retain the meaning of both axes.
  document.getElementById('chartType').value = 'harmonics';
  vm.runInContext('resetDataRange(); updateAnalysisView()', context);
  let rendered = vm.runInContext('activeCharts', context);
  assert.equal(rendered.length, 2);
  assert.deepEqual(Array.from(rendered[0].config.data.datasets, d => d.label), ['U1','U2','U3']);
  assert.deepEqual(Array.from(rendered[1].config.data.datasets, d => d.label), ['I1','I2','I3']);
  assert.ok(rendered.every(c => c.config.type === 'bar'));
  const expectedU1 = actual.observations[15].channels.find(c => c.name === 'H U1' && c.instance.channelGroupID === '3');
  assert.equal(rendered[0].config.data.datasets[0].data.find(p=>p.x===3).y, expectedU1.series[1].values.at(-1));
  assert.equal(rendered[0].config.data.datasets[0].data.length, 51);

  document.getElementById('chartType').value = 'thd-trend';
  vm.runInContext('updateAnalysisView()', context);
  rendered = vm.runInContext('activeCharts', context);
  assert.equal(rendered[0].config.data.datasets.length, 3);
  assert.match(rendered[0].config.options.scales.x.ticks.callback(Date.parse('2024-09-01T00:00:00Z')), /2024/);
  vm.runInContext("analysisSelections.set('thd-trend', new Set()); renderCharts()", context);
  assert.equal(vm.runInContext('activeCharts.length', context), 0, 'deselecting all does not restore default channels');

  document.getElementById('chartType').value = 'histogram';
  document.getElementById('histogramWidth').value = '0.01';
  vm.runInContext('updateAnalysisView()', context);
  rendered = vm.runInContext('activeCharts', context);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].config.data.datasets[0].data.reduce((n,p)=>n+p.y,0), 1009);
  assert.match(rendered[0].config.options.scales.y.title.text, /count/);
  assert.throws(() => vm.runInContext('buildHistogram(seriesCatalog[0], 0)',context), /Resolution/);
  const million = vm.runInContext(`(() => {
    const time = {valueTypeName:'Time',values:Array.from({length:1000000},(_,i)=>i)};
    const values = {values:Array.from({length:1000000},(_,i)=>i%2 ? 50.01 : 50)};
    const item = {observation:{startTime:'2024-09-01T00:00:00Z'},channel:{series:[time,values]},series:values};
    return buildHistogram(item,0.01,{start:null,end:null,invalid:false});
  })()`,context);
  assert.equal(million.total,1000000);
  assert.deepEqual(Array.from(million.points,p=>p.y),[500000,500000]);

  document.getElementById('chartType').value = 'scatter';
  vm.runInContext('updateAnalysisView()',context);
  rendered = vm.runInContext('activeCharts',context);
  assert.equal(rendered[0].config.type,'scatter');
  const pair = rendered[0].config.data.datasets[0].data[0];
  const power = actual.observations[12].channels;
  assert.equal(pair.x,power.find(c=>c.name==='PTot').series[1].values[0]);
  assert.equal(pair.y,power.find(c=>c.name==='QTot').series[1].values[0]);
  vm.runInContext('swapScatterAxes()',context);
  assert.equal(vm.runInContext('activeCharts[0].config.data.datasets[0].data[0].x',context),pair.y);
  const unmatched = vm.runInContext(`(() => {
    const item = seriesCatalog.find(i=>i.id===document.getElementById('scatterX').value);
    const other = {...item,observation:{...item.observation,startTime:'2001-01-01T00:00:00Z'}};
    return pairMeasurements(item,other).length;
  })()`,context);
  assert.equal(unmatched,0);
  assert.equal(vm.runInContext('iticEventPoints().length',context),0,'sample cannot invent ITIC markers');
  assert.equal(vm.runInContext('iticRmsStatus(0.1,60)',context),'Outside envelope');
  assert.equal(vm.runInContext('iticRmsStatus(0.5,70)',context),'Inside envelope');
  assert.equal(vm.runInContext('iticRmsStatus(11,80)',context),'Outside envelope');
  assert.equal(vm.runInContext('iticRmsStatus(0.001,150)',context),'Not assessed');

  const cfg = ['Test,Device,1999','2,1A,1D','1,U1,A,,V,2,1,0,-32767,32767,1,1,P','1,Trip,,0','50','1','1000,2','01/09/2024,00:00:00.000000','01/09/2024,00:00:00.001000','ASCII','1'].join('\n');
  context.comtradeCfg = cfg;
  context.comtradeDat = new TextEncoder().encode('1,0,10,0\n2,1000,20,1').buffer;
  let recording = vm.runInContext('parseComtrade(comtradeCfg,comtradeDat)',context);
  assert.equal(recording.channels[0].points[0].y,21);
  assert.equal(recording.channels[0].points[1].y,41);
  assert.equal(recording.channels[0].points[1].x-recording.channels[0].points[0].x,1);
  for (const format of ['BINARY','BINARY32','FLOAT32']) {
    const size = format === 'BINARY' ? 12 : 14;
    const buffer = new ArrayBuffer(size*2), view = new DataView(buffer);
    for (let i=0;i<2;i++) {
      view.setUint32(i*size,i+1,true); view.setUint32(i*size+4,1000*i,true);
      if(format==='BINARY') view.setInt16(i*size+8,10*(i+1),true);
      else if(format==='BINARY32') view.setInt32(i*size+8,10*(i+1),true);
      else view.setFloat32(i*size+8,10*(i+1),true);
    }
    context.comtradeCfg = cfg.replace('ASCII',format); context.comtradeDat=buffer;
    recording=vm.runInContext('parseComtrade(comtradeCfg,comtradeDat)',context);
    assert.equal(recording.channels[0].points[1].y,41);
    context.comtradeDat=buffer.slice(0,-1);
    assert.throws(()=>vm.runInContext('parseComtrade(comtradeCfg,comtradeDat)',context),/Truncated/);
  }
  const markers = vm.runInContext(`(() => {
    const previous=LOGICAL;
    const nominal={valueTypeName:'Values',units:'Volts',nominalQuantity:100,values:[60]};
    const duration={valueTypeName:'Duration',units:'Seconds',unitsID:1,values:[0.1]};
    LOGICAL={observations:[{name:'Synthetic sag',startTime:previous.observations[0].startTime,channels:[{name:'U1',quantityTypeName:'MagDur',quantityMeasured:'Voltage',series:[duration,nominal]}]}]};
    try { return iticEventPoints(); } finally {LOGICAL=previous;}
  })()`,context);
  assert.equal(markers.length,1);
  assert.equal(markers[0].status,'Outside envelope');
  assert.equal(markers[0].y,60);

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
