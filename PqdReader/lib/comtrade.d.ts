export type BinaryInput = ArrayBuffer | ArrayBufferView;

export interface ComtradePoint {
  /** Unix time in milliseconds; may include a fractional millisecond. */
  x: number;
  /** Calibrated analog value or digital state (0 or 1). */
  y: number;
}

export interface AnalogChannel {
  name: string;
  phase: string;
  unit: string;
  a: number;
  b: number;
  skew: number;
  points: ComtradePoint[];
}

export interface DigitalChannel {
  name: string;
  phase: string;
  normalState: number;
  points: ComtradePoint[];
}

export interface ComtradeHeader {
  cause: string;
  faultNumber: string;
  triggerName: string;
  timeZone: string;
  startUtc: number | null;
  triggerUtc: number | null;
}

export interface ComtradeRecording {
  channels: AnalogChannel[];
  digitalChannels: DigitalChannel[];
  start: number;
  trigger: number;
  frequency: number;
  sampleCount: number;
  format: 'ASCII' | 'BINARY' | 'BINARY32' | 'FLOAT32';
  timeSource: 'CFG local clock' | 'HDR UTC';
  header?: ComtradeHeader;
  /** Added by the example viewer, not by parseComtrade. */
  fileName?: string;
}

/** Parse a COMTRADE CFG/DAT pair, optionally applying UTC timestamps from HDR. */
export function parseComtrade(cfgText: string, dat: BinaryInput, hdrText?: string): ComtradeRecording;
export function parseComtradeHdr(hdrText: string): ComtradeHeader;
/** Adjust an already parsed recording in place using its HDR UTC timestamps. */
export function applyComtradeHdr(recording: ComtradeRecording, hdrText: string): ComtradeRecording;

declare const library: Readonly<{
  parseComtrade: typeof parseComtrade;
  parseComtradeHdr: typeof parseComtradeHdr;
  applyComtradeHdr: typeof applyComtradeHdr;
}>;
export default library;
