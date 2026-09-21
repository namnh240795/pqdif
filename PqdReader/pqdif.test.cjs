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
    return { style: {}, classList: { add() {}, remove() {} }, value: '0',
      innerHTML: '', appendChild() {}, addEventListener() {}, querySelector: node,
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
      charts.push(this);
    }
    destroy() { this.destroyed = true; }
  }});
  vm.runInContext(librarySource, context);
  vm.runInContext(script, context);
  await vm.runInContext('loadFile(file)', context);
  assert.equal(document.getElementById('controls').style.display, 'flex');
  assert.match(document.getElementById('meta').textContent, /29 observations/);
  assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(LOGICAL)', context)), expected);
  for (let i = 0; i < actual.observations.length; i++) {
    document.getElementById('obsSelect').value = String(i);
    vm.runInContext('renderCharts()', context);
  }
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
