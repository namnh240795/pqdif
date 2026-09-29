import * as moduleNamespace from './comtrade.js';

const library = moduleNamespace.default || globalThis.Comtrade;

export const { parseComtrade, parseComtradeHdr, applyComtradeHdr } = library;
export default library;
