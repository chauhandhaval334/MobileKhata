'use strict';
const env = require('./src/config/env');
console.log('Loaded env.adminUids:', env.adminUids);
console.log('Type of adminUids:', typeof env.adminUids);
console.log('Length of adminUids:', env.adminUids.length);
console.log('First element:', JSON.stringify(env.adminUids[0]));
process.exit(0);
