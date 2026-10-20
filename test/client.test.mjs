import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// Evaluate lib/client.js in a browser-shaped sandbox and apply the plugin, the
// way the 0.2.x client module loader does: window.__ModuleLoader__.load({ id,
// factory }) where the factory receives a CJS-style `require`.
function mount({ accepted = true, served = true, snapshot: overrides = {}, ...browser } = {}) {
  let plugin;
  let page;
  let registered;
  let servedCalls = 0;
  const injectedSlots = [];
  const registrations = [];
  let cursor = 0;
  const state = [];
  const mutations = [];
  const writes = [];
  const styles = [];
  const observers = [];
  const effects = [];
  let disconnected = false;
  const disposers = [];
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

  // Minimal hooks host: hook slots persist by call order across renders, so a
  // setState written during this render is read back by the next one.
  const subscriptions = [];
  const React = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = { value: initial };
      const slot = state[index];
      return [slot.value, (value) => { slot.value = value; }];
    },
    useEffect: (fn) => { effects.push(fn); },
    useSyncExternalStore: (subscribe, read) => {
      if (!subscriptions.some((entry) => entry.read === read)) subscriptions.push({ subscribe, read });
      return read();
    }
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
    ...browser,
    document: browser.document ?? {
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ dataset: {}, setAttribute: () => {}, removeAttribute: () => {}, remove: () => {} }),
      head: { appendChild: (node) => styles.push(node) },
      body: {}
    },
    MutationObserver: browser.MutationObserver ?? class {
      constructor(callback) { observers.push(callback); }
      observe() {}
      disconnect() { disconnected = true; }
    }
  });

  const ctx = {
    locale: {
      bind: () => (key) => (key === 'title' && browser.localeTitle) || key,
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
      register: (options, component) => {
        registrations.push({ options, component });
        if (options.name === 'settings.section') { registered = options; page = component; }
      }
    },
    effect: (fn) => { const off = fn(); if (typeof off === 'function') disposers.push(off); }
  };
  for (const dependency of plugin.inject) assert.ok(dependency in ctx, `Unavailable browser service: ${dependency}`);
  plugin.apply(ctx);

  // Each render restarts the hook cursor so useState keeps returning the same
  // slots in the same order, like React does across re-renders.
  const render = () => {
    cursor = 0;
    const props = { ...(registered.inject ? registered.inject() : {}), t: (key) => key };
    const tree = page(props);
    effects.splice(0).forEach((fn) => fn());
    return tree;
  };
  if (!served) return { registered, styles, injectedSlots, servedCalls };
  render();
  return {
    render,
    registered,
    registrations,
    sectionProps: () => ({ ...registered.inject(), t: (key) => key }),
    injectedSlots,
    styles,
    observers,
    wasDisconnected: () => disconnected,
    dispose: () => disposers.forEach((fn) => fn && fn()),
    servedCalls,
    writes,
    mutations,
    replaceSnapshot: (next) => { snapshot = { ...snapshot, ...next }; },
    discard: () => { discardButton(render()).props.onClick(); }
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
// The sticky unsaved bar also renders buttons, so tests must address the footer
// action row explicitly rather than "the first button on the page".
// The sticky bar is the only place save/discard render; the footer reports
// outcomes only. Tests address that bar explicitly.
const shellOf = (tree) => findWhere(tree, (node) => node.props?.className === 'gc-unsaved-shell')[0];
const barButtons = (tree) => childrenOf(shellOf(tree)).flatMap((card) => childrenOf(card)).filter((node) => node.type === 'button');
const primaryButton = (tree) => barButtons(tree)[1];
const discardButton = (tree) => barButtons(tree)[0];
const status = (tree) => findWhere(tree, (node) => node.props?.role === 'status')[0];

test('registers a settings section, which is what shows in the settings navigation', () => {
  const app = mount();
  // Regression: registering only a Plugins-page tab removes the entry from the
  // settings navigation rail entirely.
  assert.equal(JSON.stringify(app.injectedSlots), JSON.stringify(['settings.section']));
  assert.equal(app.registered.name, 'settings.section');
  assert.equal(app.registered.id, 'git-conventions');
  assert.equal(app.registered.order, 500);
  assert.equal(app.registered.label(), 'title');
  assert.ok(app.registered.inject().store);
  assert.equal(app.registrations.some((entry) => entry.options.name === 'settings.action'), false, 'the host header must stay untouched');
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

test('the settings rail entry gets its own icon and cleans up on unload', () => {
  // The host picks rail glyphs from a hardcoded id table and settings.section has
  // no icon option, so the plugin marks its rendered row directly.
  const row = (text) => ({
    textContent: text,
    attributes: new Set(),
    querySelector: () => ({ textContent: text }),
    setAttribute(name) { this.attributes.add(name); },
    removeAttribute(name) { this.attributes.delete(name); }
  });
  const own = row('Git conventions');
  const other = row('Models');
  const rows = [own, other];
  const app = mount({
    document: {
      body: {},
      querySelector: () => null,
      querySelectorAll: () => rows,
      getElementById: () => null,
      createElement: () => ({ dataset: {}, setAttribute() {}, removeAttribute() {}, remove() {} }),
      head: { appendChild() {} }
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    // The rail matches on the localized title, so the dictionary must resolve.
    localeTitle: 'Git conventions'
  });
  assert.ok(own.attributes.has('data-git-conventions-nav-icon'));
  assert.equal(other.attributes.has('data-git-conventions-nav-icon'), false);

  // Unloading releases the mark so a stale style can never survive a reload.
  app.dispose();
  assert.equal(own.attributes.has('data-git-conventions-nav-icon'), false);
});

test('the sticky bar keeps non-negative insets and a spacing shell', () => {
  const css = mount().styles[0].textContent;
  // A negative top or negative margin drags a sticky bar past the scroll
  // container's padding box, where scrolling clips it. The shell sticks at 0 and
  // paints the page background so the gap above the card stays clean.
  const shell = /\.gc-unsaved-shell\{([^}]*)\}/.exec(css)[1];
  assert.match(shell, /position:sticky/);
  assert.match(shell, /top:0/);
  assert.doesNotMatch(shell, /top:-/);
  assert.doesNotMatch(shell, /margin:[^;]*-(\d)/);
  // The shell must be opaque and share the settings modal's own surface token
  // (`--dsw-alias-bg-layer-2` on .panel): transparency lets the scrolled form
  // show through the gap, and any other token reads as a colour band.
  assert.match(shell, /background:var\(--dsw-alias-bg-layer-2\)/);
  assert.doesNotMatch(shell, /background:transparent/);
  assert.doesNotMatch(shell, /background:var\(--dsw-alias-bg-base\)/);
  // The padding belongs to the shell so its opaque surface covers that gap.
  assert.match(shell, /padding:8px 0 10px/);
});

test('the page body carries no duplicate save controls', () => {
  const app = mount();
  field(app.render(), 'gc-enforce').props.onChange({ target: { checked: false } });
  const tree = app.render();
  // The header owns save/discard; repeating them inside the scrolling body put
  // two nearly identical bars at the top of the panel.
  const bar = findWhere(tree, (node) => node.props?.className === 'gc-unsaved-bar')[0];
  assert.ok(bar, 'the sticky bar carries save and discard');
  assert.equal(childrenOf(bar).filter((node) => node.type === 'button').length, 2);
});

test('the header action and the footer act on the same draft', async () => {
  const app = mount();
  const { store } = app.sectionProps();
  field(app.render(), 'gc-enforce').props.onChange({ target: { checked: false } });
  assert.equal(store.dirty(), true, 'the footer edit must reach the shared store');

  await store.save((key) => key);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(app.mutations[0].ops), JSON.stringify([{ op: 'set', path: ['enforce'], value: false }]));
  assert.equal(store.dirty(), false, 'a successful save clears the draft for both buttons');
});

test('the icon style travels with the plugin so the rail mark can render', () => {
  const css = mount().styles.map((el) => el.textContent || '').join('\n');
  // The mark alone renders nothing; the ::before mask rule must be injected too.
  assert.match(css, /data-git-conventions-nav-icon\]>svg\{display:none\}/);
  assert.match(css, /data-git-conventions-nav-icon\]::before\{[^}]*mask:/);
});

test('the layout follows the host spacing scale', () => {
  const css = mount().styles[0].textContent;
  // Host settings copy is 14px/22px and groups are spaced 16-20px apart; a
  // 13px/8px layout reads cramped beside the host's own pages.
  assert.match(css, /\.gc-page\{[^}]*gap:20px/);
  assert.match(css, /\.gc-section\{[^}]*gap:12px/);
  assert.match(css, /\.gc-section\{[^}]*padding-top:16px/);
  assert.match(css, /\.gc-label\{[^}]*font-size:14px/);
  assert.match(css, /\.gc-check-label\{[^}]*font-size:14px/);
  assert.match(css, /\.gc-hint\{[^}]*font-size:14px/);
});

test('buttons match the host settings-button sizing', () => {
  const css = mount().styles[0].textContent;
  // The host's own settings buttons are 36px tall with 14px/22px type; a smaller
  // variant reads as cramped beside them.
  assert.match(css, /\.gc-button\{[^}]*height:36px/);
  assert.match(css, /\.gc-button\{[^}]*padding:0 20px/);
  assert.match(css, /\.gc-button\{[^}]*font-size:14px/);
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
  const save = primaryButton(app.render());
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
  primaryButton(app.render()).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(app.mutations[0].ops), JSON.stringify([{ op: 'unset', path: ['commitInstructions'] }]));
});

test('a refused write surfaces as a failure, and discarding restores the host values', async () => {
  const app = mount({ accepted: false });
  field(app.render(), 'gc-enforce').props.onChange({ target: { checked: false } });
  primaryButton(app.render()).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status(app.render()).props.className, 'gc-status-err');
  app.sectionProps().store.discard();
  assert.equal(field(app.render(), 'gc-enforce').props.checked, true);
});

test('a stale revision is not written over a newer host snapshot', async () => {
  const app = mount();
  field(app.render(), 'gc-enforce').props.onChange({ target: { checked: false } });
  app.replaceSnapshot({ revision: 2, value: { commitInstructions: '', prInstructions: '', enforce: true, tools: ['bash', 'terminal_send'], strictCommit: true, useForceWithLease: true, requirePrBody: true } });
  primaryButton(app.render()).props.onClick();
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
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ dataset: {}, setAttribute() {}, removeAttribute() {}, remove() {} }), head: { appendChild() {} }, body: {} },
    MutationObserver: class { observe() {} disconnect() {} }
  });
  plugin.apply({
    locale: { bind: () => (key) => key, register: () => () => {} },
    configForms: { get: () => ({}), whileServed: (ids, register) => register(new Set(ids)) },
    slots: { inject: () => { injected = true; }, register: () => undefined },
    effect: (fn) => fn()
  });
  assert.equal(injected, true);
});
