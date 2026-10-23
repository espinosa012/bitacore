const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Load browser-side modules (IIFEs attached to window.VG) into a sandbox
 * so they can be unit tested from Node without a DOM.
 * @param {string[]} files - Paths relative to the repo root, in load order.
 * @param {object} [extraGlobals] - Optional additional globals to expose in the sandbox.
 * @returns {object} The sandbox `window` object.
 */
function loadBrowserModules(files, extraGlobals = {}) {
  const window = {};
  const sandbox = { window, console, Date, JSON, Math, ...extraGlobals };
  vm.createContext(sandbox);
  for (const file of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  return window;
}

module.exports = { loadBrowserModules };
