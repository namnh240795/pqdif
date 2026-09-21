/** Synchronous zlib decompression. Node uses built-in zlib; browsers use pako. */
export type Inflate = (bytes: Uint8Array) => Uint8Array;
export type BinaryInput = ArrayBuffer | ArrayBufferView;

export interface Series {
  valueType: string;
  valueTypeName: string;
  units: string;
  unitsID: number;
  characteristic: string;
  storageMethod: string;
  storageMethodID: number;
  nominalQuantity: number;
  seriesShareChannelIndex: string;
  seriesShareSeriesIndex: string;
  count: number;
  values: number[];
}
export interface ChannelDefinition {
  channelName: string;
  phase: string;
  phaseID: number;
  quantityTypeID: string;
  quantityTypeName: string;
  quantityMeasured: string;
  quantityMeasuredID: number;
  quantityName: string;
}
export interface ChannelSetting {
  channelDefinitionIndex: number;
  xdSystemSideRatio: number;
  xdMonitorSideRatio: number;
}
export interface Channel {
  name: string;
  phase: string;
  quantityType: string;
  quantityTypeName: string;
  quantityMeasured: string;
  definition: ChannelDefinition;
  instance: {
    channelDefinitionIndex: number;
    channelGroupID: string;
    triggerModuleName: string;
    crossTriggerDeviceName: string;
  };
  setting: Partial<ChannelSetting>;
  series: Series[];
}
export interface Observation {
  name: string;
  startTime: string;
  createTime: string;
  triggerMethod: string;
  timeTriggered: string;
  disturbanceCategoryID: string;
  disturbanceCategoryName: string;
  channelTriggerIndex: number[];
  dataSource: {
    name: string;
    owner: string;
    location: string;
    typeID: string;
    vendorID: string;
    equipmentID: string;
    longitude: string;
    latitude: string;
    effective: string;
  };
  monitorSettings: {
    effective: string;
    timeInstalled: string;
    useCalibration: boolean;
    useTransducer: boolean;
    nominalFrequency: number;
  };
  channels: Channel[];
}
export interface PqdifData {
  title: string;
  subject: string;
  notes: string;
  creationTime: string;
  version: string;
  fileName: string;
  compressionStyle: string;
  compressionAlgorithm: string;
  compatibleVersion: string;
  channels: Channel[];
  observations: Observation[];
}
export interface PhysicalElement {
  tag: string;
  type: number;
  value?: unknown;
  vectorValues?: unknown[];
  children?: PhysicalElement[];
}
export interface PhysicalRecord {
  type: string;
  body: { children: PhysicalElement[] };
}
export class PqdifParser {
  constructor(buffer: BinaryInput, inflate?: Inflate);
  parseFile(): PhysicalRecord[];
}
/** Matches the Gemstone.PQDIF Program.cs JSON contract. Throws on invalid records. */
export function parsePqdif(buffer: BinaryInput, inflate?: Inflate): PqdifData;
export const seriesValueTypeNames: Readonly<Record<string, string>>;
declare const library: Readonly<{
  parsePqdif: typeof parsePqdif;
  PqdifParser: typeof PqdifParser;
  seriesValueTypeNames: typeof seriesValueTypeNames;
}>;
export default library;
