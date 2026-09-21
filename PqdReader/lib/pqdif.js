// Shared synchronous PQDIF reader for Node.js and classic browser scripts.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('node:zlib').inflateSync);
  } else {
    root.Pqdif = factory(bytes => {
      if (!root.pako || typeof root.pako.inflate !== 'function') {
        throw new Error('Zlib-compressed PQDIF files require pako. Load pako before parsing, or supply an inflate function.');
      }
      return root.pako.inflate(bytes);
    });
  }
})(globalThis, function (defaultInflate) {
'use strict';

const RECORD_SIGNATURE = [0x40,0x14,0x11,0x4a,0x9f,0xe4,0xcf,0x11,0x99,0x00,0x50,0x51,0x44,0x49,0x46,0x00];
const RECORD_TYPES = {
  '89738606-f1c3-11cf-9d89-0080c72e70a3': 'Container',
  '89738619-f1c3-11cf-9d89-0080c72e70a3': 'DataSource',
  'b48d858c-f5f5-11cf-9d89-0080c72e70a3': 'MonitorSettings',
  '8973861a-f1c3-11cf-9d89-0080c72e70a3': 'Observation',
  '89738618-f1c3-11cf-9d89-0080c72e70a3': 'Blank',
};
const PHYSICAL_TYPE_SIZES = { 1:1, 2:2, 3:4, 10:1, 11:2, 20:1, 21:2, 22:4, 30:1, 31:2, 32:4, 40:4, 41:8, 42:8, 43:16, 50:12, 60:16 };

// Tag GUIDs and names mirror Gemstone.PQDIF source and TagDefinitions.xml.
const T = {
  "VersionInfoTag": "89738607-f1c3-11cf-9d89-0080c72e70a3",
  "FileNameTag": "89738608-f1c3-11cf-9d89-0080c72e70a3",
  "CreationTag": "89738609-f1c3-11cf-9d89-0080c72e70a3",
  "TitleTag": "8973860d-f1c3-11cf-9d89-0080c72e70a3",
  "SubjectTag": "8973860e-f1c3-11cf-9d89-0080c72e70a3",
  "NotesTag": "89738617-f1c3-11cf-9d89-0080c72e70a3",
  "CompressionStyleTag": "8973861b-f1c3-11cf-9d89-0080c72e70a3",
  "CompressionAlgorithmTag": "8973861c-f1c3-11cf-9d89-0080c72e70a3",
  "Measure": "e6b51730-f747-11cf-9d89-0080c72e70a3",
  "Manual": "e6b51731-f747-11cf-9d89-0080c72e70a3",
  "Simulate": "e6b51732-f747-11cf-9d89-0080c72e70a3",
  "Benchmark": "e6b51733-f747-11cf-9d89-0080c72e70a3",
  "Debug": "e6b51734-f747-11cf-9d89-0080c72e70a3",
  "DataSourceTypeIDTag": "b48d8581-f5f5-11cf-9d89-0080c72e70a3",
  "VendorIDTag": "b48d8582-f5f5-11cf-9d89-0080c72e70a3",
  "EquipmentIDTag": "b48d8583-f5f5-11cf-9d89-0080c72e70a3",
  "DataSourceNameTag": "b48d8587-f5f5-11cf-9d89-0080c72e70a3",
  "DataSourceOwnerTag": "b48d8588-f5f5-11cf-9d89-0080c72e70a3",
  "DataSourceLocationTag": "b48d8589-f5f5-11cf-9d89-0080c72e70a3",
  "DataSourceCoordinatesTag": "b48d858b-f5f5-11cf-9d89-0080c72e70a3",
  "ChannelDefinitionsTag": "b48d858d-f5f5-11cf-9d89-0080c72e70a3",
  "OneChannelDefinitionTag": "b48d858e-f5f5-11cf-9d89-0080c72e70a3",
  "EffectiveTag": "62f28183-f9c4-11cf-9d89-0080c72e70a3",
  "TimeInstalledTag": "3d786f85-f76e-11cf-9d89-0080c72e70a3",
  "UseCalibrationTag": "62f28180-f9c4-11cf-9d89-0080c72e70a3",
  "UseTransducerTag": "62f28181-f9c4-11cf-9d89-0080c72e70a3",
  "ChannelSettingsArrayTag": "62f28182-f9c4-11cf-9d89-0080c72e70a3",
  "OneChannelSettingTag": "3d786f9a-f76e-11cf-9d89-0080c72e70a3",
  "NominalFrequencyTag": "0fa118c3-cb4a-11d2-b30b-fe25cb9a1760",
  "ObservationNameTag": "3d786f8a-f76e-11cf-9d89-0080c72e70a3",
  "TimeCreateTag": "3d786f8b-f76e-11cf-9d89-0080c72e70a3",
  "TimeStartTag": "3d786f8c-f76e-11cf-9d89-0080c72e70a3",
  "TriggerMethodTag": "3d786f8d-f76e-11cf-9d89-0080c72e70a3",
  "TimeTriggeredTag": "3d786f8e-f76e-11cf-9d89-0080c72e70a3",
  "ChannelTriggerIndexTag": "3d786f8f-f76e-11cf-9d89-0080c72e70a3",
  "ChannelInstancesTag": "3d786f91-f76e-11cf-9d89-0080c72e70a3",
  "OneChannelInstanceTag": "3d786f92-f76e-11cf-9d89-0080c72e70a3",
  "DisturbanceCategoryTag": "b48d8597-f5f5-11cf-9d89-0080c72e70a3",
  "ChannelDefinitionIndexTag": "b48d858f-f5f5-11cf-9d89-0080c72e70a3",
  "ChannelNameTag": "b48d8590-f5f5-11cf-9d89-0080c72e70a3",
  "PhaseIDTag": "b48d8591-f5f5-11cf-9d89-0080c72e70a3",
  "QuantityTypeIDTag": "b48d8592-f5f5-11cf-9d89-0080c72e70a3",
  "QuantityMeasuredIDTag": "c690e872-f755-11cf-9d89-0080c72e70a3",
  "QuantityNameTag": "b48d8595-f5f5-11cf-9d89-0080c72e70a3",
  "SeriesDefinitionsTag": "b48d8598-f5f5-11cf-9d89-0080c72e70a3",
  "OneSeriesDefinitionTag": "b48d859a-f5f5-11cf-9d89-0080c72e70a3",
  "ChannelGroupIDTag": "f90de218-e67b-4cf1-a295-b021a2d46767",
  "SeriesInstancesTag": "3d786f93-f76e-11cf-9d89-0080c72e70a3",
  "OneSeriesInstanceTag": "3d786f94-f76e-11cf-9d89-0080c72e70a3",
  "ChannelTriggerModuleNameTag": "0fa118c6-cb4a-11cf-9d89-0080c72e70a3",
  "CrossTriggerDeviceNameTag": "0fa118c5-cb4a-11cf-9d89-0080c72e70a3",
  "XDSystemSideRatioTag": "62f2818a-f9c4-11cf-9d89-0080c72e70a3",
  "XDMonitorSideRatioTag": "62f2818b-f9c4-11cf-9d89-0080c72e70a3",
  "ValueTypeIDTag": "b48d859c-f5f5-11cf-9d89-0080c72e70a3",
  "QuantityUnitsIDTag": "b48d859b-f5f5-11cf-9d89-0080c72e70a3",
  "QuantityCharacteristicIDTag": "3d786f9e-f76e-11cf-9d89-0080c72e70a3",
  "StorageMethodIDTag": "b48d85a1-f5f5-11cf-9d89-0080c72e70a3",
  "ValueTypeNameTag": "b48d859d-f5f5-11cf-9d89-0080c72e70a3",
  "SeriesNominalQuantityTag": "0fa118c8-cb4a-11d2-b30b-fe25cb9a1760",
  "SeriesScaleTag": "3d786f96-f76e-11cf-9d89-0080c72e70a3",
  "SeriesOffsetTag": "3d786f97-f76e-11cf-9d89-0080c72e70a3",
  "SeriesValuesTag": "3d786f99-f76e-11cf-9d89-0080c72e70a3",
  "SeriesShareChannelIndexTag": "8973861f-f1c3-11cf-9d89-0080c72e70a3",
  "SeriesShareSeriesIndexTag": "89738620-f1c3-11cf-9d89-0080c72e70a3"
};
const NAMES = {
  "Phase": {
    "0": "None",
    "1": "AN",
    "2": "BN",
    "3": "CN",
    "4": "NG",
    "5": "AB",
    "6": "BC",
    "7": "CA",
    "8": "Residual",
    "9": "Net",
    "10": "PositiveSequence",
    "11": "NegativeSequence",
    "12": "ZeroSequence",
    "13": "Total",
    "14": "LineToNeutralAverage",
    "15": "LineToLineAverage",
    "16": "Worst",
    "17": "Plus",
    "18": "Minus",
    "19": "General1",
    "20": "General2",
    "21": "General3",
    "22": "General4",
    "23": "General5",
    "24": "General6",
    "25": "General7",
    "26": "General8",
    "27": "General9",
    "28": "General10",
    "29": "General11",
    "30": "General12",
    "31": "General13",
    "32": "General14",
    "33": "General15",
    "34": "General16"
  },
  "QuantityMeasured": {
    "0": "None",
    "1": "Voltage",
    "2": "Current",
    "3": "Power",
    "4": "Energy",
    "5": "Temperature",
    "6": "Pressure",
    "7": "Charge",
    "8": "ElectricalField",
    "9": "MagneticField",
    "10": "Velocity",
    "11": "Bearing",
    "12": "Force",
    "13": "Torque",
    "14": "Position",
    "15": "FluxLinkage",
    "16": "FluxDensity",
    "17": "Status"
  },
  "StorageMethods": {
    "1": "Values",
    "2": "Scaled",
    "4": "Increment"
  },
  "QuantityUnits": {
    "0": "None",
    "1": "Timestamp",
    "2": "Seconds",
    "3": "Cycles",
    "6": "Volts",
    "7": "Amps",
    "8": "VoltAmps",
    "9": "Watts",
    "10": "Vars",
    "11": "Ohms",
    "12": "Siemens",
    "13": "VoltsPerAmp",
    "14": "Joules",
    "15": "Hertz",
    "16": "Celcius",
    "17": "Degrees",
    "18": "Decibels",
    "19": "Percent",
    "20": "PerUnit",
    "21": "Samples",
    "22": "VarHours",
    "23": "WattHours",
    "24": "VoltAmpHours",
    "25": "MetersPerSecond",
    "26": "MilesPerHour",
    "27": "Bars",
    "28": "Pascals",
    "29": "Newtons",
    "30": "NewtonMeters",
    "31": "RevolutionsPerMinute",
    "32": "RadiansPerSecond",
    "33": "Meters",
    "34": "WeberTurns",
    "35": "Teslas",
    "36": "Webers",
    "37": "VoltsPerVolt",
    "38": "AmpsPerAmp",
    "39": "AmpsPerVolt"
  },
  "TriggerMethod": {
    "0": "None",
    "1": "Channel",
    "2": "Periodic",
    "3": "External",
    "4": "PeriodicStats"
  },
  "QuantityType": {
    "67f6af80-f753-11cf-9d89-0080c72e70a3": "WaveForm",
    "67f6af82-f753-11cf-9d89-0080c72e70a3": "ValueLog",
    "67f6af81-f753-11cf-9d89-0080c72e70a3": "Phasor",
    "67f6af85-f753-11cf-9d89-0080c72e70a3": "Response",
    "67f6af83-f753-11cf-9d89-0080c72e70a3": "Flash",
    "67f6af87-f753-11cf-9d89-0080c72e70a3": "Histogram",
    "67f6af88-f753-11cf-9d89-0080c72e70a3": "Histogram3D",
    "67f6af89-f753-11cf-9d89-0080c72e70a3": "CPF",
    "67f6af8a-f753-11cf-9d89-0080c72e70a3": "XY",
    "67f6af8b-f753-11cf-9d89-0080c72e70a3": "MagDur",
    "67f6af8c-f753-11cf-9d89-0080c72e70a3": "XYZ",
    "67f6af8d-f753-11cf-9d89-0080c72e70a3": "MagDurTime",
    "67f6af8e-f753-11cf-9d89-0080c72e70a3": "MagDurCount"
  },
  "DisturbanceCategory": {
    "67f6af8f-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_NONE",
    "67f6af90-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_TRANSIENT",
    "dd56ef60-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_IMPULSIVE",
    "dd56ef61-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_IMPULSIVE_NANO",
    "dd56ef63-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_IMPULSIVE_MICRO",
    "dd56ef64-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_IMPULSIVE_MILLI",
    "dd56ef65-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_OSCILLATORY",
    "dd56ef66-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_OSCILLATORY_LOWFREQ",
    "dd56ef67-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_OSCILLATORY_MEDFREQ",
    "dd56ef68-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_TRANSIENT_OSCILLATORY_HIGHFREQ",
    "67f6af91-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_SHORTDUR",
    "dd56ef69-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_INSTANT",
    "dd56ef6a-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_INSTANT_SAG",
    "dd56ef6b-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_INSTANT_SWELL",
    "dd56ef6c-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_MOMENT",
    "dd56ef6d-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_MOMENT_INTERRUPT",
    "dd56ef6e-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_MOMENT_SAG",
    "dd56ef6f-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_MOMENT_SWELL",
    "dd56ef70-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_TEMP",
    "dd56ef71-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_TEMP_INTERRUPT",
    "dd56ef72-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_TEMP_SAG",
    "dd56ef73-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_SHORTDUR_TEMP_SWELL",
    "67f6af92-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_LONGDUR",
    "dd56ef74-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_LONGDUR_INTERRUPT",
    "dd56ef75-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_LONGDUR_SAG",
    "dd56ef76-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_LONGDUR_SWELL",
    "dd56ef77-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_IMBALANCE",
    "dd56ef7e-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_POWERFREQVARIATION",
    "67f6af93-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_VOLTAGEFLUCTUATION",
    "67f6af94-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_WAVEDISTORT",
    "dd56ef78-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_WAVEDISTORT_DCOFFSET",
    "dd56ef79-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_WAVEDISTORT_HARMONIC",
    "dd56ef7a-7edd-11d2-b30a-00609789d193": "ID_DISTURB_1159_WAVEDISTORT_INTERHARMONIC",
    "67f6af95-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_WAVEDISTORT_NOTCHING",
    "67f6af96-f753-11cf-9d89-0080c72e70a3": "ID_DISTURB_1159_WAVEDISTORT_NOISE"
  },
  "SeriesValueType": {
  "67f6af97-f753-11cf-9d89-0080c72e70a3": "Values",
  "c690e862-f755-11cf-9d89-0080c72e70a3": "Time",
  "67f6af98-f753-11cf-9d89-0080c72e70a3": "Minimum",
  "67f6af99-f753-11cf-9d89-0080c72e70a3": "Maximum",
  "67f6af9a-f753-11cf-9d89-0080c72e70a3": "Average",
  "67f6af9b-f753-11cf-9d89-0080c72e70a3": "Instantaneous",
  "3d786f9d-f76e-11cf-9d89-0080c72e70a3": "Phase Angle",
  "dc762340-3c56-11d2-ae44-0060083a2628": "Phase Angle Mininum",
  "dc762341-3c56-11d2-ae44-0060083a2628": "Phase Angle Maximum",
  "dc762342-3c56-11d2-ae44-0060083a2628": "Phase Angle Average",
  "c7825ce0-8ace-11d3-b92f-0050da2b1f4d": "Area",
  "c690e864-f755-11cf-9d89-0080c72e70a3": "Latitude",
  "c690e863-f755-11cf-9d89-0080c72e70a3": "Duration",
  "c690e865-f755-11cf-9d89-0080c72e70a3": "Longitude",
  "c690e866-f755-11cf-9d89-0080c72e70a3": "Polarity",
  "c690e867-f755-11cf-9d89-0080c72e70a3": "Ellipse",
  "c690e869-f755-11cf-9d89-0080c72e70a3": "Bin ID",
  "c690e86a-f755-11cf-9d89-0080c72e70a3": "Bin High",
  "c690e86b-f755-11cf-9d89-0080c72e70a3": "Bin Low",
  "c690e86c-f755-11cf-9d89-0080c72e70a3": "X Bin High",
  "c690e86d-f755-11cf-9d89-0080c72e70a3": "X Bin Low",
  "c690e86e-f755-11cf-9d89-0080c72e70a3": "Y Bin High",
  "c690e86f-f755-11cf-9d89-0080c72e70a3": "Y Bin Low",
  "c690e870-f755-11cf-9d89-0080c72e70a3": "Count",
  "5369c260-c347-11d2-923f-00104b2b84b1": "Transition",
  "6763cc71-17d6-11d4-9f1c-002078e0b723": "Probability",
  "72e82a40-336c-11d5-a4b3-444553540000": "Interval",
  "b82b5c82-55c7-11d5-a4b3-444553540000": "Status",
  "67f6af9c-f753-11cf-9d89-0080c72e70a3": "Probability: 1%",
  "67f6af9d-f753-11cf-9d89-0080c72e70a3": "Probability: 5%",
  "67f6af9e-f753-11cf-9d89-0080c72e70a3": "Probability: 10%",
  "67f6af9f-f753-11cf-9d89-0080c72e70a3": "Probability: 90%",
  "c690e860-f755-11cf-9d89-0080c72e70a3": "Probability: 95%",
  "c690e861-f755-11cf-9d89-0080c72e70a3": "Probability: 99%",
  "c690e868-f755-11cf-9d89-0080c72e70a3": "Frequency"
}
};
// The parser is independent of the DOM. Supply pako.inflate in the browser or
// node:zlib.inflateSync in Node.js; both consume the same record bodies.
class PqdifParser {
  constructor(buffer, inflate = defaultInflate) {
    if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
      throw new TypeError('Expected an ArrayBuffer, Buffer, or typed array');
    }
    if (typeof inflate !== 'function') throw new TypeError('inflate must be a function');
    this.bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.inflate = inflate;
  }

  guid(dv, offset) {
    const h = Array.from(new Uint8Array(dv.buffer, dv.byteOffset + offset, 16), b => b.toString(16).padStart(2, '0'));
    return h[3]+h[2]+h[1]+h[0]+'-'+h[5]+h[4]+'-'+h[7]+h[6]+'-'+h[8]+h[9]+'-'+h.slice(10).join('');
  }

  timestamp(dv, offset) {
    const days = dv.getUint32(offset, true);
    const seconds = dv.getFloat64(offset + 4, true);
    // DateTime.AddSeconds on .NET 10 truncates to 100 ns ticks. Keep the
    // fractional ticks separate: JavaScript Date only retains milliseconds.
    const whole = Math.trunc(seconds);
    const ticks = BigInt(whole) * 10000000n + BigInt(Math.trunc((seconds - whole) * 10000000));
    const midnight = Date.UTC(1900, 0, 1) + (days - 2) * 86400000;
    const date = new Date(midnight + Number(ticks / 10000000n) * 1000);
    return date.toISOString().slice(0, 19) + '.' + (ticks % 10000000n).toString().padStart(7, '0');
  }

  scalar(dv, offset, type) {
    switch (type) {
      case 1: return dv.getUint8(offset) !== 0;
      case 2: return dv.getUint16(offset, true) !== 0;
      case 3: return dv.getUint32(offset, true) !== 0;
      case 10: return String.fromCharCode(dv.getUint8(offset));
      case 11: return String.fromCharCode(dv.getUint16(offset, true));
      case 20: return dv.getInt8(offset);
      case 21: return dv.getInt16(offset, true);
      case 22: return dv.getInt32(offset, true);
      case 30: return dv.getUint8(offset);
      case 31: return dv.getUint16(offset, true);
      case 32: return dv.getUint32(offset, true);
      case 40: return dv.getFloat32(offset, true);
      case 41: return dv.getFloat64(offset, true);
      case 42: return { real: dv.getFloat32(offset, true), imaginary: dv.getFloat32(offset + 4, true) };
      case 43: return { real: dv.getFloat64(offset, true), imaginary: dv.getFloat64(offset + 8, true) };
      case 50: return this.timestamp(dv, offset);
      case 60: return this.guid(dv, offset);
      default: throw new Error(`Unsupported physical type ${type}`);
    }
  }

  collection(dv, offset, depth = 0) {
    if (depth > 50) throw new Error('PQDIF collection nesting exceeds 50 levels');
    const count = dv.getInt32(offset, true);
    if (count < 0 || offset + 4 + count * 28 > dv.byteLength) throw new Error('Invalid PQDIF collection size');
    const children = [];
    for (let i = 0; i < count; i++) {
      const slot = offset + 4 + i * 28;
      const tag = this.guid(dv, slot);
      const kind = dv.getUint8(slot + 16);
      const type = dv.getUint8(slot + 17);
      const embedded = dv.getUint8(slot + 18) !== 0;
      const link = kind === 2 && embedded ? slot + 20 : dv.getInt32(slot + 20, true);
      if (link < 0 || link >= dv.byteLength) throw new Error(`Invalid element link for ${tag}`);
      const child = { tag, type };
      if (kind === 1) child.children = this.collection(dv, link, depth + 1).children;
      else if (kind === 2) child.value = this.scalar(dv, link, type);
      else if (kind === 3) {
        const size = PHYSICAL_TYPE_SIZES[type];
        const length = dv.getInt32(link, true);
        if (!size || length < 0 || link + 4 + length * size > dv.byteLength) throw new Error(`Invalid vector for ${tag}`);
        child.vectorValues = Array.from({ length }, (_, j) => this.scalar(dv, link + 4 + j * size, type));
        if (type === 10 || type === 11) child.value = child.vectorValues.join('').replace(/\0+$/, '');
      }
      children.push(child);
    }
    return { children };
  }

  parseFile() {
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const records = [];
    let pos = 0, style = 0, algorithm = 0;
    while (true) {
      if (pos + 64 > dv.byteLength) throw new Error('Truncated PQDIF record header');
      if (!RECORD_SIGNATURE.every((b, i) => dv.getUint8(pos + i) === b)) throw new Error(`Invalid PQDIF signature at ${pos}`);
      const type = RECORD_TYPES[this.guid(dv, pos + 16)] || 'Unknown';
      const headerSize = dv.getInt32(pos + 32, true);
      const bodySize = dv.getInt32(pos + 36, true);
      const next = dv.getInt32(pos + 40, true);
      if (headerSize < 64 || bodySize < 0 || pos + headerSize + bodySize > dv.byteLength) throw new Error('Invalid PQDIF record size');
      let bytes = this.bytes.subarray(pos + headerSize, pos + headerSize + bodySize);
      if (style !== 0 && algorithm === 1 && bytes.length) bytes = this.inflate(bytes);
      const body = bytes.length ? this.collection(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0) : { children: [] };
      records.push({ type, body });
      if (records.length === 1 && type !== 'Container') throw new Error('First PQDIF record must be a container');
      if (type === 'Container') {
        style = value(body, 'CompressionStyleTag', 0);
        algorithm = value(body, 'CompressionAlgorithmTag', 0);
        if (style !== 0 && style !== 2) throw new Error(`Unsupported compression style ${style}`);
        if (algorithm !== 0 && algorithm !== 1) throw new Error(`Unsupported compression algorithm ${algorithm}`);
      }
      if (next === 0) break;
      if (next < pos + headerSize + bodySize || next >= dv.byteLength) throw new Error('Invalid next PQDIF record position');
      pos = next;
    }
    return records;
  }
}

function element(body, tag) { return body?.children?.find(c => c.tag === T[tag]); }
function value(body, tag, fallback = '') { return element(body, tag)?.value ?? fallback; }
function vector(body, tag) { return element(body, tag)?.vectorValues ?? []; }
function children(body, tag) { return element(body, tag)?.children ?? []; }
function enumName(type, id) { return NAMES[type][id] ?? String(id); }
function storageName(id) {
  return id > 0 && (id & ~7) === 0 ? [1, 2, 4].filter(bit => id & bit).map(bit => NAMES.StorageMethods[bit]).join(', ') : String(id);
}

// Matches the JSON contract in PqdReader/Program.cs, including optional defaults.
function extractLogicalData(records) {
  const container = records.find(r => r.type === 'Container')?.body;
  if (!container) throw new Error('Missing PQDIF container');
  const version = vector(container, 'VersionInfoTag');
  const result = {
    title: value(container, 'TitleTag'), subject: value(container, 'SubjectTag'), notes: value(container, 'NotesTag'),
    creationTime: value(container, 'CreationTag'), version: `${version[0]}.${version[1]}`,
    fileName: value(container, 'FileNameTag'),
    compressionStyle: ({ 0: 'None', 1: 'TotalFile', 2: 'RecordLevel' })[value(container, 'CompressionStyleTag', 0)],
    compressionAlgorithm: ({ 0: 'None', 1: 'Zlib', 64: 'PKZIP' })[value(container, 'CompressionAlgorithmTag', 0)],
    compatibleVersion: `${version[2]}.${version[3]}`, channels: [], observations: []
  };
  let source, settings;
  for (const record of records) {
    const body = record.body;
    if (record.type === 'DataSource') source = body;
    if (record.type === 'MonitorSettings') settings = body;
    if (record.type !== 'Observation') continue;
    if (!source) throw new Error('Observation has no preceding data source');
    const disturbance = value(body, 'DisturbanceCategoryTag', '67f6af8f-f753-11cf-9d89-0080c72e70a3');
    const coords = vector(source, 'DataSourceCoordinatesTag');
    const observation = {
      name: value(body, 'ObservationNameTag'), startTime: value(body, 'TimeStartTag'), createTime: value(body, 'TimeCreateTag'),
      triggerMethod: enumName('TriggerMethod', value(body, 'TriggerMethodTag', 0)),
      timeTriggered: value(body, 'TimeTriggeredTag', '0001-01-01T00:00:00.0000000'),
      disturbanceCategoryID: disturbance, disturbanceCategoryName: NAMES.DisturbanceCategory[disturbance] ?? disturbance,
      channelTriggerIndex: vector(body, 'ChannelTriggerIndexTag'),
      dataSource: {
        name: value(source, 'DataSourceNameTag'), owner: value(source, 'DataSourceOwnerTag'), location: value(source, 'DataSourceLocationTag'),
        typeID: value(source, 'DataSourceTypeIDTag'), vendorID: value(source, 'VendorIDTag'), equipmentID: value(source, 'EquipmentIDTag'),
        longitude: String(coords[0] ?? 4294967295), latitude: String(coords[1] ?? 4294967295), effective: value(source, 'EffectiveTag')
      },
      monitorSettings: {
        effective: value(settings, 'EffectiveTag'), timeInstalled: value(settings, 'TimeInstalledTag'),
        useCalibration: value(settings, 'UseCalibrationTag', false), useTransducer: value(settings, 'UseTransducerTag', false),
        nominalFrequency: value(settings, 'NominalFrequencyTag', 60)
      }, channels: []
    };
    const instances = children(body, 'ChannelInstancesTag');
    const definitions = children(source, 'ChannelDefinitionsTag');
    const channelSettings = children(settings, 'ChannelSettingsArrayTag');
    const rawSeries = instances.map(ch => children(ch, 'SeriesInstancesTag'));

    // Shared values take precedence over local values; scale and offset fall
    // back independently to the referenced series (as in SeriesInstance.cs).
    function resolveSeries(ci, si, seen = new Set()) {
      const key = `${ci}:${si}`;
      if (seen.has(key)) throw new Error('Circular PQDIF series sharing');
      seen.add(key);
      const raw = rawSeries[ci]?.[si];
      if (!raw) throw new Error(`Missing shared series ${key}`);
      const shareChannel = value(raw, 'SeriesShareChannelIndexTag', null);
      const shareSeries = value(raw, 'SeriesShareSeriesIndexTag', null);
      const shared = shareChannel !== null && shareSeries !== null ? resolveSeries(shareChannel, shareSeries, seen) : null;
      return {
        values: shared?.values ?? element(raw, 'SeriesValuesTag'),
        scale: element(raw, 'SeriesScaleTag') ?? shared?.scale,
        offset: element(raw, 'SeriesOffsetTag') ?? shared?.offset
      };
    }

    instances.forEach((instance, ci) => {
      const index = value(instance, 'ChannelDefinitionIndexTag', -1);
      const def = definitions[index];
      if (!def) throw new Error(`Missing channel definition ${index}`);
      const setting = channelSettings.find(s => value(s, 'ChannelDefinitionIndexTag', -1) === index);
      const name = value(def, 'ChannelNameTag');
      const phaseID = value(def, 'PhaseIDTag', 0), phase = enumName('Phase', phaseID);
      const quantityType = value(def, 'QuantityTypeIDTag'), quantityTypeName = NAMES.QuantityType[quantityType] ?? '';
      const quantityMeasuredID = value(def, 'QuantityMeasuredIDTag', 0), quantityMeasured = enumName('QuantityMeasured', quantityMeasuredID);
      const channel = {
        name, phase, quantityType, quantityTypeName, quantityMeasured,
        definition: { channelName: name, phase, phaseID, quantityTypeID: quantityType, quantityTypeName, quantityMeasured, quantityMeasuredID, quantityName: value(def, 'QuantityNameTag') },
        instance: { channelDefinitionIndex: index, channelGroupID: String(value(instance, 'ChannelGroupIDTag', 0)), triggerModuleName: value(instance, 'ChannelTriggerModuleNameTag'), crossTriggerDeviceName: value(instance, 'CrossTriggerDeviceNameTag') },
        setting: setting ? { channelDefinitionIndex: index, xdSystemSideRatio: value(setting, 'XDSystemSideRatioTag', 1), xdMonitorSideRatio: value(setting, 'XDMonitorSideRatioTag', 1) } : {},
        series: []
      };
      const seriesDefs = children(def, 'SeriesDefinitionsTag');
      rawSeries[ci].forEach((raw, si) => {
        const sd = seriesDefs[si];
        if (!sd) throw new Error(`Missing series definition ${si}`);
        const unitsID = value(sd, 'QuantityUnitsIDTag', 0), storageMethodID = value(sd, 'StorageMethodIDTag', 1);
        const series = {
          valueType: value(sd, 'ValueTypeIDTag'), valueTypeName: value(sd, 'ValueTypeNameTag'), units: enumName('QuantityUnits', unitsID), unitsID,
          characteristic: value(sd, 'QuantityCharacteristicIDTag'), storageMethod: storageName(storageMethodID), storageMethodID,
          nominalQuantity: value(sd, 'SeriesNominalQuantityTag', 0),
          seriesShareChannelIndex: String(value(raw, 'SeriesShareChannelIndexTag')), seriesShareSeriesIndex: String(value(raw, 'SeriesShareSeriesIndexTag')),
          count: 0, values: []
        };
        try {
          const resolved = resolveSeries(ci, si);
          if (!resolved.values) throw new Error('Missing series values');
          const stored = resolved.values.vectorValues;
          let values = [];
          if (storageMethodID & 4) {
            let start = 0;
            for (let rate = 0; rate < stored[0]; rate++) {
              const count = stored[rate * 2 + 1], increment = stored[rate * 2 + 2];
              if (!Number.isFinite(count) || count < 0 || !Number.isFinite(increment)) throw new Error('Invalid increment series');
              for (let j = 0; j < count; j++) values.push(start + j * increment);
              start = count * increment;
            }
          } else values = stored.slice();
          // Program.cs cannot Convert.ToDouble a timestamp or complex value.
          if ([10, 11, 42, 43, 50, 60].includes(resolved.values.type)) throw new Error('Non-numeric series');
          const scale = storageMethodID & 2 ? resolved.scale?.value ?? 1 : 1;
          const offset = storageMethodID & 2 ? resolved.offset?.value ?? 0 : 0;
          // C# dynamic arithmetic retains float32 when both operands are floats.
          const floatProduct = resolved.values.type === 40 && (!(storageMethodID & 2) || !resolved.scale || resolved.scale.type === 40);
          const floatSum = floatProduct && (!(storageMethodID & 2) || !resolved.offset || resolved.offset.type === 40);
          values = values.map(v => {
            const product = floatProduct ? Math.fround(Number(v) * scale) : Number(v) * scale;
            const sum = offset + product;
            return floatSum ? Math.fround(sum) : sum;
          });
          if (observation.monitorSettings.useTransducer && element(setting, 'XDSystemSideRatioTag') && element(setting, 'XDMonitorSideRatioTag')) {
            const ratio = channel.setting.xdSystemSideRatio / channel.setting.xdMonitorSideRatio;
            values = values.map(v => v * ratio);
          }
          series.values = values;
          series.count = values.length;
        } catch {
          // Match Program.cs: a series whose OriginalValues cannot be converted
          // is exported as count: 0, values: [].
        }
        channel.series.push(series);
      });
      observation.channels.push(channel);
    });
    result.observations.push(observation);
  }
  return result;
}

function parsePqdif(buffer, inflate) {
  return extractLogicalData(new PqdifParser(buffer, inflate).parseFile());
}

return Object.freeze({
  parsePqdif,
  PqdifParser,
  seriesValueTypeNames: Object.freeze(NAMES.SeriesValueType)
});
});
