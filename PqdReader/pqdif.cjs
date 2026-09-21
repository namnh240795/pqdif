#!/usr/bin/env node
'use strict';

// CLI and backwards-compatible entry point for the reusable library.
const fs = require('node:fs');
module.exports = require('./lib/pqdif.js');

if (require.main === module) {
  const [, , input, output] = process.argv;
  if (!input) {
    console.error('Usage: node PqdReader/pqdif.cjs <input.pqd> [output.json]');
    process.exitCode = 1;
  } else {
    try {
      const json = JSON.stringify(module.exports.parsePqdif(fs.readFileSync(input)), null, 2);
      if (output) fs.writeFileSync(output, json + '\n');
      else process.stdout.write(json + '\n');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
