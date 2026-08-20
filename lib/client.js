// Browser half of @deepseek-ai/dsh-git-conventions.
//
// Registers a standalone "Git 规范" settings section bound to the
// git-conventions namespace via ctx.settingsScope. The rule text lives in the
// Host's composition base layer: the textareas render it as placeholder, and
// only a user override becomes the stored value. All colors use --dsw-alias-*
// tokens so the form follows the shell's light/dark theme.
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-git-conventions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Button = primitives.Button;

    var NAMESPACE = "git-conventions";

    var inject = ["slots", "connection", "remote", "settingsScope"];

    // Injected by the module loader and cleaned up on unload (see client-modules
    // claimStyles). Theme-adaptive via the shell's --dsw-alias-* token sheets.
    var CSS = [
      ".gc-page{display:flex;flex-direction:column;gap:14px;padding:4px 4px 24px;max-width:680px}",
      ".gc-heading{font-size:17px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}",
      ".gc-hint{font-size:13px;line-height:1.5;margin:0;color:var(--dsw-alias-label-secondary)}",
      ".gc-label{font-size:13px;font-weight:600;margin-top:6px;color:var(--dsw-alias-label-primary)}",
      ".gc-textarea{width:100%;box-sizing:border-box;min-height:132px;padding:10px 12px;font-size:13px;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;resize:vertical;outline:none;transition:border-color 120ms ease}",
      ".gc-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}",
      ".gc-textarea:hover{border-color:var(--dsw-alias-border-l3)}",
      ".gc-textarea:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".gc-row{display:flex;align-items:center;gap:8px;margin-top:6px}",
      ".gc-check{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}",
      ".gc-check-label{font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}",
      ".gc-actions{display:flex;align-items:center;gap:12px;margin-top:10px}",
      ".gc-status-ok{font-size:13px;color:var(--dsw-alias-state-success-primary)}",
      ".gc-status-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}",
      ".gc-unavailable{font-size:13px;color:var(--dsw-alias-label-secondary)}"
    ].join("");
    var styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    function GitConventionsSection(props) {
      var scope = props.scope;
      var snapshot = React.useSyncExternalStore(
        function subscribe(cb) { return scope.subscribe(cb); },
        function getSnapshot() { return scope.getSnapshot(); }
      );

      var status = snapshot.status;
      var value = snapshot.value || {};
      var base = snapshot.base || {};
      var user = snapshot.user || {};
      var writable = snapshot.writable;

      var draftState = React.useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var savingState = React.useState(false);
      var saving = savingState[0];
      var setSaving = savingState[1];
      var messageState = React.useState(null);
      var message = messageState[0];
      var setMessage = messageState[1];

      React.useEffect(function () {
        if (draft === null && status === "ready" && snapshot.value) {
          setDraft({
            commitInstructions: user.commitInstructions == null ? "" : user.commitInstructions,
            prInstructions: user.prInstructions == null ? "" : user.prInstructions,
            enforce: value.enforce !== false,
            useForceWithLease: value.useForceWithLease !== false
          });
        }
      }, [status, draft, snapshot.value, user.commitInstructions, user.prInstructions, value.enforce, value.useForceWithLease]);

      if (status === "unavailable") {
        return React.createElement("div", { className: "gc-unavailable" }, "Git 规范设置不可用：宿主未挂载 settings 服务。");
      }
      if (draft === null) {
        return React.createElement("div", { className: "gc-unavailable" }, "加载中…");
      }

      function update(field, val) {
        var next = {
          commitInstructions: draft.commitInstructions,
          prInstructions: draft.prInstructions,
          enforce: draft.enforce,
          useForceWithLease: draft.useForceWithLease
        };
        next[field] = val;
        setDraft(next);
      }

      function save() {
        if (saving) return;
        setSaving(true);
        setMessage(null);
        var tasks = [];
        var curCommit = user.commitInstructions == null ? "" : user.commitInstructions;
        var curPr = user.prInstructions == null ? "" : user.prInstructions;
        if (draft.commitInstructions !== curCommit) tasks.push(["commitInstructions", draft.commitInstructions]);
        if (draft.prInstructions !== curPr) tasks.push(["prInstructions", draft.prInstructions]);
        if (draft.enforce !== value.enforce) tasks.push(["enforce", draft.enforce]);
        if (draft.useForceWithLease !== value.useForceWithLease) tasks.push(["useForceWithLease", draft.useForceWithLease]);

        var chain = Promise.resolve();
        for (var i = 0; i < tasks.length; i++) {
          (function (field, val) {
            chain = chain.then(function () { return scope.set(field, val); });
          })(tasks[i][0], tasks[i][1]);
        }
        chain.then(function () {
          setMessage({ type: "ok", text: "已保存" });
        }).catch(function (err) {
          setMessage({ type: "error", text: "保存失败：" + (err && err.message ? err.message : String(err)) });
        }).finally(function () {
          setSaving(false);
        });
      }

      // The default rule text lives in the Host base layer; when the Host is
      // still running an older build without it, fall back to the resolved value.
      function placeholderFor(field) {
        var b = base[field];
        if (b != null && b !== "") return b;
        var v = value[field];
        return v == null ? "" : v;
      }

      return React.createElement(
        "div",
        { className: "gc-page" },
        React.createElement("h2", { className: "gc-heading" }, "Git 规范"),
        React.createElement("p", { className: "gc-hint" }, "在 AI 执行 git commit / push / gh pr create 时按下方规则校验；保存后即时生效，无需重启。"),

        React.createElement("label", { className: "gc-label" }, "提交说明"),
        React.createElement("textarea", {
          className: "gc-textarea",
          value: draft.commitInstructions,
          placeholder: placeholderFor("commitInstructions"),
          rows: 7,
          onChange: function (e) { update("commitInstructions", e.target.value); }
        }),

        React.createElement("label", { className: "gc-label" }, "拉取请求指令"),
        React.createElement("textarea", {
          className: "gc-textarea",
          value: draft.prInstructions,
          placeholder: placeholderFor("prInstructions"),
          rows: 7,
          onChange: function (e) { update("prInstructions", e.target.value); }
        }),

        React.createElement(
          "div",
          { className: "gc-row" },
          React.createElement("input", {
            type: "checkbox",
            id: "gc-enforce",
            className: "gc-check",
            checked: draft.enforce,
            onChange: function (e) { update("enforce", e.target.checked); }
          }),
          React.createElement("label", { htmlFor: "gc-enforce", className: "gc-check-label" }, "强制拦截")
        ),
        React.createElement(
          "div",
          { className: "gc-row" },
          React.createElement("input", {
            type: "checkbox",
            id: "gc-force-lease",
            className: "gc-check",
            checked: draft.useForceWithLease,
            onChange: function (e) { update("useForceWithLease", e.target.checked); }
          }),
          React.createElement("label", { htmlFor: "gc-force-lease", className: "gc-check-label" }, "push 使用 --force-with-lease")
        ),

        React.createElement(
          "div",
          { className: "gc-actions" },
          React.createElement(
            Button,
            {
              type: "button",
              variant: "primary",
              size: "sm",
              disabled: writable === false || saving,
              onClick: save
            },
            saving ? "保存中…" : "保存"
          ),
          message ? React.createElement(
            "span",
            { className: message.type === "ok" ? "gc-status-ok" : "gc-status-err" },
            message.text
          ) : null
        )
      );
    }

    function apply(ctx) {
      var scope = ctx.settingsScope.bind({ namespace: NAMESPACE });

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "git-conventions",
          order: 500,
          label: function () { return "Git 规范"; },
          inject: function () { return { scope: scope }; }
        }, GitConventionsSection);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
