import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

function mount(accepted = true, browser = {}) {
  let plugin, section, cursor = 0;
  const state = [];
  const effects = [];
  const writes = [];
  const disposers = [];
  const form = {
    getSnapshot: () => ({ status: 'ready', value: { enforce: true, useForceWithLease: true }, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async (field, value) => { writes.push([field, value]); return accepted; },
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState: (initial) => {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [state[i], (value) => { state[i] = value; }];
    },
    useEffect: (fn) => effects.push(fn),
  };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory((id) => {
      if (id === 'react') return React;
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button' };
      throw new Error(`Unexpected import: ${id}`);
    }); } } },
    document: { createElement: () => ({ remove() {} }), head: { appendChild() {} }, querySelectorAll: () => [], body: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    ...browser,
  });
  const ctx = {
    connection: {},
    remote: {},
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => { section = { options, component }; },
    },
    configForms: { get: (id) => { assert.equal(id, 'git-conventions'); return form; } },
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (fn) => { disposers.push(fn()); },
  };
  for (const dependency of plugin.inject) assert.ok(dependency in ctx, `Unavailable browser service: ${dependency}`);
  plugin.apply(ctx);
  const render = () => {
    cursor = 0;
    const tree = section.component({ ...section.options.inject(), t: (key) => key });
    effects.splice(0).forEach((fn) => fn());
    return tree;
  };
  render();
  return { render, writes, dispose: () => disposers.forEach((fn) => fn?.()) };
}

function find(node, type) {
  if (node?.type === type) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, type);
    if (found) return found;
  }
}

test('current browser services activate the settings page and save a rule', async () => {
  const app = mount();
  find(app.render(), 'textarea').props.onChange({ target: { value: 'Custom rule' } });
  find(app.render(), 'button').props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(app.writes, [['commitInstructions', 'Custom rule']]);
  assert.equal(find(app.render(), 'span').props.className, 'gc-status-ok');
});

test('a refused settings write is shown as a failure, not saved', async () => {
  const app = mount(false);
  find(app.render(), 'textarea').props.onChange({ target: { value: 'Custom rule' } });
  find(app.render(), 'button').props.onClick();
  await new Promise(setImmediate);
  assert.equal(find(app.render(), 'span').props.className, 'gc-status-err');
});

test('nav icon follows its own localized row and cleans up on unload', () => {
  const marker = 'data-git-conventions-nav-icon';
  const row = (textContent) => ({
    textContent, attributes: new Set(), matches: () => true,
    setAttribute(name) { this.attributes.add(name); },
    removeAttribute(name) { this.attributes.delete(name); },
  });
  const own = row('title'), other = row('Models');
  const rows = [own, other];
  const styles = new Set();
  let sync, disconnected = false;
  const app = mount(true, {
    document: {
      body: {},
      createElement: () => ({ remove() { styles.delete(this); } }),
      head: { appendChild(style) { styles.add(style); } },
      querySelectorAll: () => rows,
    },
    MutationObserver: class {
      constructor(callback) { sync = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  });
  assert.ok(own.attributes.has(marker));
  assert.equal(other.attributes.has(marker), false);
  own.textContent = 'Other section';
  const remounted = row('title');
  rows.push(remounted);
  sync();
  assert.equal(own.attributes.has(marker), false);
  assert.ok(remounted.attributes.has(marker));
  assert.match([...styles][1].textContent, /background:currentColor/);
  app.dispose();
  assert.ok(disconnected);
  assert.equal(remounted.attributes.has(marker), false);
  assert.equal(styles.size, 1);
});
