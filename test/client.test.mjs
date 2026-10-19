import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// Evaluate lib/client.js in a browser-shaped sandbox and apply the plugin, the
// way the 0.2.x client module loader does: window.__ModuleLoader__.load({ id,
// factory }) where the factory receives a CJS-style `require`.
function mount({ accepted = true, served = true, snapshot: overrides = {} } = {}) {
  let plugin;
  let page;
  let registered;
  let servedCalls = 0;
  const injectedSlots = [];
  let cursor = 0;
  const state = [];
  const mutations = [];
  const writes = [];
  const styles = [];
  let snapshot = {
    status: 'ready',
    value: { commitInstructions: '', prInstructions: '', enforce: true, tools: ['bash', 'terminal_send'], strictCommit: true, useForceWithLease: true, requirePrBody: true },
    base: {},
    user: {},
    writable: true,
    revision: 1,
    ...overrides
  };

  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops, revision) => {
      mutations.push(JSON.parse(JSON.stringify({ ops, revision })));
      if (!accepted || revision !== snapshot.revision) return false;
      for (const { op, path: [field], value } of ops) writes.push([field, op === 'unset' ? undefined : value]);
      snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, ...Object.fromEntries(writes) } };
      return true;
    }
  };

  const React = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useSyncExternalStore: (_subscribe, read) => read()
  };
  // Mirrors react/jsx-runtime exactly: the third positional argument is the key
  // and nothing else, so children passed there are dropped just like in a
  // browser — which is what makes the text assertions below meaningful.
  const jsxRuntime = {
    jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
    jsxs: (type, props, key) => ({ type, props: props ?? {}, key })
  };

  runInNewContext(SOURCE, {
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => {
          assert.equal(id, 'dsh-git-conventions');
          plugin = factory((name) => {
            if (name === 'react') return React;
            if (name === 'react/jsx-runtime') return jsxRuntime;
            throw new Error(`Unexpected import: ${name}`);
          });
        }
      }
    },
    document: {
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({ dataset: {} }),
      head: { appendChild: (node) => styles.push(node) }
    }
  });

  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: () => () => {}
    },
    configForms: {
      get: (id) => { assert.equal(id, 'git-conventions'); return form; },
      whileServed: (ids, register) => {
        servedCalls += 1;
        assert.equal(JSON.stringify(ids), JSON.stringify(['git-conventions']));
        return register(new Set(ids));
      }
    },
    slots: {
      inject: (name, fn) => { injectedSlots.push(name); return fn(); },
      register: (options, component) => { registered = options; page = component; }
    },
    effect: (fn) => { fn(); }
  };
  for (const dependency of plugin.inject) assert.ok(dependency in ctx, `Unavailable browser service: ${dependency}`);
  plugin.apply(ctx);

  const render = () => {
    cursor = 0;
    return page({ ...(registered.inject ? registered.inject() : {}), t: (key) => key });
  };
  if (!served) return { registered, styles, injectedSlots, servedCalls };
  render();
  return {
    render,
    registered,
    injectedSlots,
    servedCalls,
    writes,
    mutations,
    styles,
    replaceSnapshot: (next) => { snapshot = { ...snapshot, ...next }; },
    discard: () => {
      const actions = findAll(render(), 'div').find((node) => node.props.className === 'gc-actions');
      childrenOf(actions)[1].props.onClick();
    }
  };
}

// Elements built by our jsx-runtime mock keep children on props.children,
// exactly like react/jsx-runtime does at render time.
function childrenOf(node) {
  const children = node?.props?.children;
  if (Array.isArray(children)) return children.filter(Boolean);
  return children === undefined || children === null ? [] : [children];
}

function findAll(node, type, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (node.type === type) found.push(node);
  for (const child of childrenOf(node)) findAll(child, type, found);
  return found;
}

function findWhere(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  for (const child of childrenOf(node)) findWhere(child, predicate, found);
  return found;
}

const field = (tree, id) => findWhere(tree, (node) => node.props?.id === id)[0];
const status = (tree) => findWhere(tree, (node) => node.props?.role === 'status')[0];

test('registers a settings section, which is what shows in the settings navigation', () => {
  const app = mount();
  // Regression: registering only a Plugins-page tab removes the entry from the
  // settings navigation rail entirely.
  assert.deepEqual(app.injectedSlots, ['settings.section']);
  assert.equal(app.registered.name, 'settings.section');
  assert.equal(app.registered.id, 'git-conventions');
  assert.equal(app.registered.order, 500);
  assert.equal(app.registered.label(), 'title');
  assert.ok(app.registered.inject().scope);
  assert.match(app.styles[0].textContent, /--dsw-alias-label-primary/);
});

test('every label, heading and button carries visible text', () => {
  const tree = mount().render();
  // Regression: children handed to jsx() as a positional argument land in the
  // key slot and vanish, leaving an empty <h3></h3> with a styled class — the
  // page looked blank apart from native input text.
  const visible = findWhere(tree, (node) => ['h3', 'h4', 'p', 'label', 'button'].includes(node.type))
    .map((node) => node.props?.children)
    .filter((child) => typeof child === 'string');
  assert.ok(visible.length >= 14, `expected at least 14 text nodes, saw ${visible.length}`);
  for (const text of visible) assert.ok(String(text).trim().length > 0, 'a rendered text node is empty');
});

test('the primary button keeps a readable label once disabled', () => {
  const css = mount().styles[0].textContent;
  // A disabled primary button must not keep the brand fill or its paired
  // foreground: in dark mode that pairing is light-on-light and the label
  // disappears, which is how the page shipped an apparently empty button.
  assert.match(css, /data-variant=primary\]:disabled\{[^}]*color:var\(--dsw-alias-label-(?:secondary|primary)\)[^}]*background:var\(--dsw-alias-bg-layer-2\)/);
  assert.doesNotMatch(css, /\.gc-button:disabled\{[^}]*opacity/);
});

test('the page styles are untagged so the host style sweep cannot strip them', () => {
  const app = mount();
  const tag = app.styles[0];
  // client-modules removes every <style data-plugin=dsh-git-conventions> when it
  // tears down or reloads this package; tagging our tag would wipe the page CSS.
  assert.equal(tag.dataset.plugin, undefined);
  assert.equal(tag.id, 'dsh-git-conventions-style');
});

test('the section registers without waiting on the settings describe snapshot', () => {
  const app = mount();
  // Gating on configForms.whileServed leaves the section unregistered whenever
  // the describe view has not landed, so the page never appears.
  assert.equal(app.servedCalls, 0);
  assert.equal(app.registered.name, 'settings.section');
});

test('renders current values and saves only the fields that changed', async () => {
  const app = mount({ snapshot: { value: { commitInstructions: '', prInstructions: '', enforce: true, tools: ['bash'], strictCommit: true, useForceWithLease: true, requirePrBody: true } } });
  app.render();
  const tree = app.render();
  assert.equal(field(tree, 'gc-commitInstructions').props.value, '');
  assert.equal(field(tree, 'gc-tools').props.value, 'bash');

  field(tree, 'gc-strictCommit').props.onChange({ target: { checked: false } });
  field(app.render(), 'gc-tools').props.onChange({ target: { value: 'bash, terminal_send' } });
  const save = findAll(app.render(), 'button')[0];
  save.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(app.mutations.length, 1);
  assert.equal(app.mutations[0].revision, 1);
  assert.equal(JSON.stringify(app.mutations[0].ops), JSON.stringify([
    { op: 'set', path: ['strictCommit'], value: false },
    { op: 'set', path: ['tools'], value: ['bash', 'terminal_send'] }
  ]));
  assert.equal(status(app.render()).props.className, 'gc-status-ok');
});

test('an emptied rule text unsets the override instead of storing an empty string', async () => {
  const app = mount({ snapshot: { value: { commitInstructions: 'Owner rule', prInstructions: '', enforce: true, tools: ['bash'], strictCommit: true, useForceWithLease: true, requirePrBody: true } } });
  field(app.render(), 'gc-commitInstructions').props.onChange({ target: { value: '   ' } });
  findAll(app.render(), 'button')[0].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(app.mutations[0].ops), JSON.stringify([{ op: 'unset', path: ['commitInstructions'] }]));
});

test('a refused write surfaces as a failure, and discard restores the host values', async () => {
  const app = mount({ accepted: false });
  field(app.render(), 'gc-enforce').props.onChange({ target: { checked: false } });
  findAll(app.render(), 'button')[0].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status(app.render()).props.className, 'gc-status-err');
  app.discard();
  assert.equal(field(app.render(), 'gc-enforce').props.checked, true);
});

test('a stale revision is not written over a newer host snapshot', async () => {
  const app = mount();
  field(app.render(), 'gc-enforce').props.onChange({ target: { checked: false } });
  app.replaceSnapshot({ revision: 2, value: { commitInstructions: '', prInstructions: '', enforce: true, tools: ['bash', 'terminal_send'], strictCommit: true, useForceWithLease: true, requirePrBody: true } });
  findAll(app.render(), 'button')[0].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status(app.render()).props.className, 'gc-status-err');
});

test('unready and read-only hosts render a notice instead of an editable form', () => {
  const loading = mount({ snapshot: { status: 'loading' } });
  assert.equal(findAll(loading.render(), 'textarea').length, 0);
  assert.equal(findWhere(loading.render(), (node) => node.props?.className === 'gc-unavailable').length, 1);

  const readOnly = mount({ snapshot: { writable: false } });
  const commit = field(readOnly.render(), 'gc-commitInstructions');
  assert.equal(commit.props.disabled, true);
});

test('the section is registered during apply', () => {
  mount({ served: false });
  let injected = false;
  let plugin;
  runInNewContext(SOURCE, {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})); } } },
    document: { querySelector: () => null, getElementById: () => null, createElement: () => ({ dataset: {} }), head: { appendChild() {} } }
  });
  plugin.apply({
    locale: { bind: () => (key) => key, register: () => () => {} },
    configForms: { get: () => ({}), whileServed: (ids, register) => register(new Set(ids)) },
    slots: { inject: () => { injected = true; }, register: () => undefined },
    effect: (fn) => fn()
  });
  assert.equal(injected, true);
});
