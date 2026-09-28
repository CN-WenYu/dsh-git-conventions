import assert from 'node:assert/strict';
import test from 'node:test';
import * as plugin from '../lib/index.js';

test('activates with current settings and reads live rules and locale', () => {
  let guard;
  let value = { enforce: true, useForceWithLease: true };
  let locale = 'en';
  const ctx = {
    settings: {
      describe: () => [{ ns: 'locale', value: { preference: locale } }],
      configure: () => () => {},
    },
    effect: (fn) => fn(),
    tools: { guard: (fn) => { guard = fn; } },
  };
  plugin.apply(ctx, { get: () => value });
  const check = (command) => guard({ name: 'bash', arguments: { command } });
  assert.match(check('git commit -m bad'), /Commit message/);
  assert.equal(check('git commit -m "fix: handle settings"'), undefined);
  value = { ...value, commitInstructions: 'Owner rule' };
  assert.match(check('git commit -m bad'), /Owner rule/);
  locale = 'zh';
  assert.match(check('git commit -m bad'), /提交信息/);
  assert.match(check('git push --force'), /force-with-lease/);
  value = { ...value, enforce: false };
  assert.equal(check('git commit -m bad'), undefined);
});

test('exports a schema usable by the current loader and settings forms', () => {
  const config = plugin.Config['~standard'].validate({});
  assert.equal(config.issues, undefined);
  assert.equal(config.value.get().enforce, true);
  assert.equal(plugin.Config.meta.volatile, true);
});
