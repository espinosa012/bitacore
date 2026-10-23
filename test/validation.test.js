const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserModules } = require('./helpers');

const { VG } = loadBrowserModules(['js/constants.js', 'js/validation.js']);

test('validateTasksJson rejects empty and wrongly shaped roots', () => {
  assert.equal(VG.Validation.validateTasksJson(null).valid, false);
  assert.equal(VG.Validation.validateTasksJson({ foo: 1 }).valid, false);
});

test('validateTasksJson rejects a non-array tags registry', () => {
  assert.equal(VG.Validation.validateTasksJson({ tags: 'x', tasks: [] }).valid, false);
});

test('validateTasksJson accepts an empty task list', () => {
  assert.equal(VG.Validation.validateTasksJson([]).valid, true);
});

test('escapeHtml escapes markup characters', () => {
  assert.equal(VG.Constants.escapeHtml('<a href="x">&</a>').includes('<'), false);
});

test('formatFileSize renders human-readable sizes', () => {
  assert.match(VG.Constants.formatFileSize(2048), /2(\.0)? ?KB/i);
});
