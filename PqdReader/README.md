# pqdif — PQDIF reader for Node.js and browsers

`lib/pqdif.js` is the shared parser for Node.js and the browser. It exports `parsePqdif`, `PqdifParser`, and `seriesValueTypeNames`. It does not read HTML, use a DOM, or execute code with `vm`. No build step is required.

## Node.js

Install the package:

```sh
npm install pqdif
```

```js
const fs = require('node:fs');
const { parsePqdif } = require('pqdif');

const result = parsePqdif(fs.readFileSync('input.pqd'));
fs.writeFileSync('output.json', JSON.stringify(result, null, 2));
```

Requires Node.js 18 or later. Node uses built-in zlib, so there are no npm dependencies to install. ES modules and TypeScript are supported:

```js
import { parsePqdif } from 'pqdif';
```

For local development before publication, run `npm install /absolute/path/to/pqdif/PqdReader` in the consuming project.

The installed package provides a CLI:

```sh
pqdif-to-json input.pqd output.json
```

The repository command-line entry also remains available:

```sh
node PqdReader/pqdif.cjs "40-6084 PQDIFExport_Utility S 10kV-v1.pqd" /tmp/pqdif-js.json
```

Omit the output path to write JSON to stdout.

## Browser

`index.html` loads the same library as a classic script, exposes it as `Pqdif`, and calls `Pqdif.parsePqdif` when a file is selected. Open the viewer, choose a `.pqd` file, and click **Download JSON**. Parsing happens locally. The viewer loads pako and Chart.js from jsDelivr.

For another HTML page, copy `node_modules/pqdif/lib/pqdif.js` into your web assets (shown here as `./lib/pqdif.js`):

```html
<script src="https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"></script>
<script src="./lib/pqdif.js"></script>
<script>
  async function readFile(file) {
    const result = Pqdif.parsePqdif(await file.arrayBuffer());
    console.log(result.observations);
  }
</script>
```

## API

`parsePqdif(buffer, inflate?)` synchronously parses an `ArrayBuffer`, Node `Buffer`, or typed-array view, respecting its byte offset and length. It returns the JSON-compatible object exported by `Program.cs`. An optional synchronous `inflate(bytes)` function can override decompression; it must return a `Uint8Array` (or Node `Buffer`). The default is Node zlib or browser `pako.inflate`. Compressed input without a browser inflater produces an explicit error.

For physical records, use `new PqdifParser(buffer, inflate?).parseFile()`. `seriesValueTypeNames` maps series value-type GUIDs to display labels; it does not replace the file's own `valueTypeName` field.

Invalid or truncated physical records throw. As in `Program.cs`, series that cannot be converted to numbers (such as timestamps) export `count: 0` and an empty `values` array. Deprecated total-file and PKZIP compression are unsupported, as in the C# library.

## License

MIT. This JavaScript implementation is derived from Gemstone.PQDIF by Grid Protection Alliance. The original copyright and license are included.

## Verification

From the repository root:

```sh
npm test --prefix PqdReader
```

The supplied fixture matches `pqdif_data.json` field for field: 29 observations, 1,094 channels, and 2,555,804 numeric values. Equality is checked after JSON parsing; whitespace and character escaping can differ from .NET's serializer.

Tests cover Node and browser library entry points, padded input buffers, missing decompression support, invalid input, and the viewer's file-loading, chart-data preparation, and JSON-export paths. The browser branch runs in a JavaScript VM with Node zlib standing in for pako and DOM/Chart doubles; these tests do not verify actual browser rendering or CDN loading.
