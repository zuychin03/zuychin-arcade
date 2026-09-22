const path = require('node:path');
const original = require('../../apps/mobile/tailwind.config.js');
module.exports = { ...original, content: ['app', 'components'].map(folder => path.resolve(__dirname, '../../apps/mobile', folder).replaceAll('\\', '/') + '/**/*.{js,ts,jsx,tsx}') };
