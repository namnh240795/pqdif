// COMTRADE 1999/2013 reader shared by Node.js and classic browsers.
(function (root, factory) {
  const library = factory();
  if (typeof module === 'object' && module.exports) module.exports = library;
  else root.Comtrade = library;
})(globalThis, function () {
'use strict';

function binaryBytes(input) {
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer || Object.prototype.toString.call(input) === '[object ArrayBuffer]')
    return new Uint8Array(input);
  throw new TypeError('COMTRADE DAT must be an ArrayBuffer or typed-array view.');
}

function comtradeDate(text) {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) throw new Error('Unsupported COMTRADE date. Expected DD/MM/YYYY,HH:MM:SS.ffffff.');
  const [, d, m, y, h, min, sec, fraction = ''] = match;
  return new Date(Number(y), Number(m)-1, Number(d), Number(h), Number(min), Number(sec), Number((fraction+'000').slice(0,3))).getTime();
}
function parseComtrade(cfgText, buffer, hdrText) {
  const bytes = binaryBytes(buffer);
  const lines = cfgText.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const fields = line => line.split(',').map(v=>v.trim());
  const revision = fields(lines[0] || '')[2];
  if (!['1999', '2013'].includes(revision)) throw new Error('Supported COMTRADE CFG revisions: 1999 and 2013.');
  const counts = fields(lines[1] || '');
  const total = Number(counts[0]), analogCount = Number((counts[1] || '').replace(/A$/i,'')), digitalCount = Number((counts[2] || '').replace(/D$/i,''));
  if (!Number.isInteger(analogCount) || analogCount < 1 || analogCount > 1000 || !Number.isInteger(digitalCount) || digitalCount < 0 || total !== analogCount+digitalCount) throw new Error('Invalid COMTRADE channel counts.');
  const channels = [];
  for (let i = 0; i < analogCount; i++) {
    const f = fields(lines[2+i] || '');
    const a = Number(f[5]), b = Number(f[6]), skew = Number(f[7] || 0);
    if (f.length < 10 || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(skew)) throw new Error('Invalid COMTRADE analog channel calibration.');
    channels.push({name:f[1],phase:f[2],unit:f[4],a,b,skew,points:[]});
  }
  const digitalChannels = [];
  for (let i = 0; i < digitalCount; i++) {
    const f = fields(lines[2+analogCount+i] || '');
    if (f.length < 2 || !f[1]) throw new Error('Invalid COMTRADE digital channel.');
    digitalChannels.push({name:f[1],phase:f[2] || '',normalState:Number(f[4] || 0),points:[]});
  }
  let cursor = 2+total;
  const frequency = Number(lines[cursor++]);
  const rateCount = Number(lines[cursor++]);
  if (!Number.isInteger(rateCount) || rateCount < 0 || rateCount > 1000) throw new Error('Invalid COMTRADE sample rates.');
  const rates = [];
  for (let i=0; i<rateCount; i++) {
    const [rate,end] = fields(lines[cursor++]).map(Number);
    if (!(rate>0) || !Number.isInteger(end) || end<1 || (rates.length && end<=rates.at(-1).end)) throw new Error('Invalid COMTRADE sample rate segment.');
    rates.push({rate,end});
  }
  const start = comtradeDate(lines[cursor++]);
  const trigger = comtradeDate(lines[cursor++]);
  const format = String(lines[cursor++] || '').toUpperCase();
  const multiplier = lines[cursor] === undefined ? 1 : Number(lines[cursor]);
  if (!Number.isFinite(multiplier) || multiplier<=0) throw new Error('Invalid COMTRADE timestamp multiplier.');
  function sampleTime(sample, rawTime) {
    if (!Number.isFinite(rawTime) || rawTime < 0 || !Number.isInteger(sample) || sample < 1) throw new Error('Invalid COMTRADE timestamp/sample number.');
    if (rawTime !== 0 || sample === 1) return rawTime * multiplier / 1000000;
    let elapsed=0, previousEnd=0;
    for (const segment of rates) {
      if (sample<=segment.end) return elapsed + (sample-previousEnd-1)/segment.rate;
      elapsed += (segment.end-previousEnd)/segment.rate; previousEnd=segment.end;
    }
    throw new Error('COMTRADE sample has no timestamp or valid sample rate.');
  }
  let sampleCount=0;
  function append(sample, rawTime, values, digitalValues) {
    const seconds = sampleTime(sample,rawTime);
    const x = start+seconds*1000;
    channels.forEach((channel,i) => {
      const value=values[i];
      if (Number.isFinite(value)) channel.points.push({x:x+channel.skew/1000,y:channel.a*value+channel.b});
    });
    digitalChannels.forEach((channel,i) => channel.points.push({x,y:digitalValues[i]}));
    sampleCount++;
  }
  if (format === 'ASCII') {
    const rows = new TextDecoder().decode(bytes).trim().split(/\r?\n/);
    for (const row of rows) {
      const f = fields(row);
      if (f.length < 2+total || f.slice(0,2+analogCount).some(v=>v==='')) throw new Error('Truncated COMTRADE ASCII record.');
      const values = f.slice(2,2+analogCount).map(Number);
      if (values.some(v=>!Number.isFinite(v))) throw new Error('Invalid COMTRADE ASCII sample.');
      const states = f.slice(2+analogCount,2+total).map(Number);
      if (states.some(value => value !== 0 && value !== 1)) throw new Error('Invalid COMTRADE digital sample.');
      append(Number(f[0]),Number(f[1]),values,states);
    }
  } else if (['BINARY','BINARY32','FLOAT32'].includes(format)) {
    const analogSize = format === 'BINARY' ? 2 : 4;
    const recordSize = 8 + analogCount*analogSize + Math.ceil(digitalCount/16)*2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!bytes.byteLength || bytes.byteLength%recordSize) throw new Error('Truncated COMTRADE binary data.');
    for (let offset=0; offset<bytes.byteLength; offset+=recordSize) {
      const values=[];
      for(let i=0;i<analogCount;i++) {
        const pos=offset+8+i*analogSize;
        const value=format==='FLOAT32' ? view.getFloat32(pos,true) : format==='BINARY32' ? view.getInt32(pos,true) : view.getInt16(pos,true);
        const missing=format==='BINARY' ? -32768 : -2147483648;
        values.push(format !== 'FLOAT32' && value===missing ? NaN : value);
      }
      const digitalOffset=offset+8+analogCount*analogSize;
      const states=digitalChannels.map((_,i) =>
        (view.getUint16(digitalOffset+Math.floor(i/16)*2,true) >> (i%16)) & 1);
      append(view.getUint32(offset,true),view.getUint32(offset+4,true),values,states);
    }
  } else throw new Error(`Unsupported COMTRADE data format: ${format}.`);
  if (!sampleCount) throw new Error('COMTRADE recording contains no samples.');
  if (!channels.some(channel => channel.points.length)) throw new Error('COMTRADE recording contains no valid analog samples.');
  const recording = {channels,digitalChannels,start,trigger,frequency,sampleCount,format,timeSource:'CFG local clock'};
  return hdrText === undefined ? recording : applyComtradeHdr(recording, hdrText);
}
function parseComtradeHdr(text) {
  const fields = new Map(text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => {
    const separator = line.indexOf(':');
    return separator < 0 ? [] : [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
  }).filter(pair => pair.length));
  const utcDate = value => {
    const match = String(value || '').match(/^UTC\s+(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/i);
    if (!match) return null;
    const [, day, month, year, hour, minute, second, fraction = ''] = match;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
      Number(second), Number((fraction + '000').slice(0, 3)));
  };
  return {
    cause: fields.get('cause / ursache') || '',
    faultNumber: fields.get('fault number / stoerfallnummer') || '',
    triggerName: fields.get('trigger name / triggername') || '',
    timeZone: fields.get('time zone / zeitzone') || '',
    startUtc: utcDate(fields.get('start time / startzeit')),
    triggerUtc: utcDate(fields.get('trigger time / triggerzeit'))
  };
}
function applyComtradeHdr(recording, hdrText) {
  const header = parseComtradeHdr(hdrText);
  recording.header = header;
  if (header.startUtc === null || header.triggerUtc === null) return recording;
  const cfgInterval = recording.trigger - recording.start;
  const utcInterval = header.triggerUtc - header.startUtc;
  if (Math.abs(cfgInterval - utcInterval) > 2) throw new Error('COMTRADE CFG and HDR trigger intervals disagree.');
  const shift = header.startUtc - recording.start;
  recording.channels.forEach(channel => channel.points.forEach(point => { point.x += shift; }));
  recording.digitalChannels.forEach(channel => channel.points.forEach(point => { point.x += shift; }));
  recording.start = header.startUtc;
  recording.trigger = header.triggerUtc;
  recording.timeSource = 'HDR UTC';
  return recording;
}

return Object.freeze({ parseComtrade, parseComtradeHdr, applyComtradeHdr });
});
