use crate::framework::{
    ToolCtx, ToolError, ToolExecResult, ToolResult, page_json, parse_args, text_result,
};
use browseros_core::{PageId, Ref, SessionId, input::ScrollDirection, pages::NewPageOptions};
use futures_util::future::BoxFuture;
use rquickjs::{
    Array, AsyncContext, AsyncRuntime, CatchResultExt, CaughtError, Ctx, Exception, FromJs,
    Function, IntoJs, Object, Promise, Value as JsValue,
    function::{Async, Func},
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::{Instant, sleep_until};

const DEFAULT_TIMEOUT_MS: f64 = 30_000.0;

const DESCRIPTION: &str = r#"Run JavaScript against the `browser` SDK in the server runtime for multi-step flows and data extraction that would otherwise take many tool calls. `console.log` is captured; `return` a value to read it back; exceptions come back as a result, not a thrown error.

Available as `browser`:
  browser.pages.list() / newPage(url) / close(pageId) / getInfo(pageId)
  browser.observe(pageId).snapshot()  -> { text, refs }
  browser.observe(pageId).diff()      -> { text, added, removed, changed }
  browser.observe(pageId).resolveRef(ref)
  browser.input(pageId).click(ref) / fill(ref,value) / type(text) / press(key) / hover(ref) / selectOption(ref,value) / scroll(dir,amount,ref?)
  browser.nav(pageId).goto(url) / back() / forward() / reload()
  browser.cdp(method, params?, sessionId?)   // raw CDP escape hatch
  browser.cdpJsonForPage(pageId, method, paramsJson) // page-scoped raw CDP with validated JSON params
Refs (eN) come from a snapshot's text/refs."#;

const BOOTSTRAP_JS: &str = r#"
(() => {
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

  function safeStringify(value) {
    if (value === undefined) return 'undefined';
    try {
      const encoded = JSON.stringify(value, null, 2);
      return encoded ?? String(value);
    } catch {
      return String(value);
    }
  }

  function jsonSafeString(value) {
    const seen = new WeakSet();
    let encoded;
    try {
      encoded = JSON.stringify(value, (_key, next) => {
        if (typeof next === 'bigint') return next.toString();
        if (typeof next === 'function' || typeof next === 'symbol') {
          return String(next);
        }
        if (typeof next === 'number' && !Number.isFinite(next)) return null;
        if (typeof next === 'object' && next !== null) {
          if (seen.has(next)) return '[Circular]';
          seen.add(next);
        }
        return next;
      });
    } catch {
      return JSON.stringify(safeStringify(value));
    }
    return encoded;
  }

  function call(method, args) {
    return __browserosCall(method, JSON.stringify(args ?? []));
  }

  function scoped(prefix, pageId) {
    return (name, args) => call(`${prefix}.${name}`, [pageId, ...args]);
  }

  const browser = {
    pages: {
      list: () => call('pages.list', []),
      newPage: (url) => call('pages.newPage', [url]),
      close: (pageId) => call('pages.close', [pageId]),
      getInfo: (pageId) => call('pages.getInfo', [pageId]),
    },
    observe: (pageId) => {
      const run = scoped('observe', pageId);
      return {
        snapshot: () => run('snapshot', []),
        diff: () => run('diff', []),
        resolveRef: (ref) => run('resolveRef', [ref]),
      };
    },
    input: (pageId) => {
      const run = scoped('input', pageId);
      return {
        click: (ref) => run('click', [ref]),
        fill: (ref, value) => run('fill', [ref, value]),
        type: (text) => run('type', [text]),
        press: (key) => run('press', [key]),
        hover: (ref) => run('hover', [ref]),
        selectOption: (ref, value) => run('selectOption', [ref, value]),
        scroll: (dir, amount, ref) => run('scroll', [dir, amount, ref]),
      };
    },
    nav: (pageId) => {
      const run = scoped('nav', pageId);
      return {
        goto: (url) => run('goto', [url]),
        back: () => run('back', []),
        forward: () => run('forward', []),
        reload: () => run('reload', []),
      };
    },
    cdp: (method, params, sessionId) => call('cdp', [method, params, sessionId]),
    cdpJsonForPage: (pageId, method, paramsJson) =>
      call('cdpJsonForPage', [pageId, method, paramsJson]),
  };

  const sink = (level) => (...parts) => {
    __browserosPushLog(
      `${level}${parts
        .map((part) => (typeof part === 'string' ? part : safeStringify(part)))
        .join(' ')}`
    );
  };

  globalThis.__browserosBrowser = browser;
  globalThis.__browserosConsole = {
    log: sink(''),
    info: sink(''),
    warn: sink('warn: '),
    error: sink('error: '),
    debug: sink(''),
  };
  globalThis.__browserosMakeRunFunction = (code) =>
    new AsyncFunction('browser', 'console', `"use strict";\n${code}`);
  globalThis.__browserosJsonSafeString = jsonSafeString;
  globalThis.__browserosSafeStringify = safeStringify;
})();
"#;

#[derive(Debug, Clone, Deserialize, JsonSchema)]
struct RunArgs {
    /// Async-capable JS body. Use top-level await; `return` a value.
    code: String,
    /// Max run time in ms (default 30000).
    #[serde(default = "default_timeout")]
    timeout: f64,
}

#[derive(Debug, Clone, serde::Serialize, JsonSchema)]
struct RunOutput {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    logs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub fn definition() -> crate::framework::ToolDef {
    super::def_with_output::<RunArgs, RunOutput>(
        "run",
        DESCRIPTION,
        Some(super::open_world_annotations()),
        handler,
    )
}

fn handler<'a>(
    raw: Value,
    ctx: &'a ToolCtx,
    _response: &'a mut crate::response::ToolResponse,
) -> BoxFuture<'a, ToolExecResult<Option<ToolResult>>> {
    Box::pin(async move {
        let args: RunArgs = parse_args(raw)?;
        let outcome = match execute_run(args, ctx).await {
            Ok(outcome) => outcome,
            Err(RunError::Syntax(message)) => {
                return Ok(Some(crate::framework::error_result(format!(
                    "run: syntax error - {message}"
                ))));
            }
            Err(RunError::Cancelled) => return Err(ToolError::Cancelled),
            Err(RunError::Engine(message)) => return Err(ToolError::message(message)),
        };
        Ok(Some(outcome.into_tool_result()))
    })
}

fn default_timeout() -> f64 {
    DEFAULT_TIMEOUT_MS
}

#[derive(Clone)]
struct RunControl {
    cancel: tokio_util::sync::CancellationToken,
    deadline: Instant,
    timeout_message: Arc<str>,
}

impl RunControl {
    async fn race<F, T>(&self, future: F) -> Result<T, String>
    where
        F: Future<Output = Result<T, browseros_core::CoreError>>,
    {
        tokio::select! {
            () = self.cancel.cancelled() => Err("cancelled".to_string()),
            () = sleep_until(self.deadline) => Err(self.timeout_message.to_string()),
            result = future => result.map_err(|err| err.to_string()),
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancel.is_cancelled()
    }

    fn timed_out(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

#[derive(Clone)]
struct BrowserBridge {
    session: Arc<browseros_core::BrowserSession>,
    control: RunControl,
}

enum BrowserCallValue {
    Json(Value),
    Undefined,
}

#[derive(Debug)]
enum RunError {
    Syntax(String),
    Cancelled,
    Engine(String),
}

struct RunOutcome {
    ok: bool,
    value: Option<Value>,
    return_text: Option<String>,
    logs: Vec<String>,
    error: Option<String>,
}

impl RunOutcome {
    fn success(value: Option<Value>, return_text: Option<String>, logs: Vec<String>) -> Self {
        Self {
            ok: true,
            value,
            return_text,
            logs,
            error: None,
        }
    }

    fn failure(error: impl Into<String>, logs: Vec<String>) -> Self {
        Self {
            ok: false,
            value: None,
            return_text: None,
            logs,
            error: Some(error.into()),
        }
    }

    fn into_tool_result(self) -> ToolResult {
        let text = format_outcome(&self);
        let structured = if self.ok {
            let mut object = Map::new();
            object.insert("ok".to_string(), json!(true));
            if let Some(value) = self.value {
                object.insert("value".to_string(), value);
            }
            object.insert("logs".to_string(), json!(self.logs));
            Value::Object(object)
        } else {
            json!({
                "ok": false,
                "logs": self.logs,
                "error": self.error,
            })
        };
        let mut result = text_result(text, Some(structured));
        result.is_error = !self.ok;
        result
    }
}

async fn execute_run(args: RunArgs, ctx: &ToolCtx) -> Result<RunOutcome, RunError> {
    ctx.throw_if_cancelled().map_err(|_| RunError::Cancelled)?;
    let logs = Arc::new(Mutex::new(Vec::<String>::new()));
    let duration = timeout_duration(args.timeout);
    let deadline = Instant::now() + duration;
    let timeout_message: Arc<str> = Arc::from(format!("run exceeded {}ms", args.timeout));
    let control = RunControl {
        cancel: ctx.cancel.clone(),
        deadline,
        timeout_message: timeout_message.clone(),
    };
    let run = execute_quickjs(
        args.code,
        ctx.session.clone(),
        logs.clone(),
        control.clone(),
        duration,
    );
    tokio::select! {
        () = ctx.cancel.cancelled() => Err(RunError::Cancelled),
        () = sleep_until(deadline) => Ok(RunOutcome::failure(timeout_message.to_string(), logs_snapshot(&logs))),
        result = run => result,
    }
}

async fn execute_quickjs(
    code: String,
    session: Arc<browseros_core::BrowserSession>,
    logs: Arc<Mutex<Vec<String>>>,
    control: RunControl,
    duration: Duration,
) -> Result<RunOutcome, RunError> {
    let runtime = AsyncRuntime::new().map_err(engine_error)?;
    let interrupt_control = control.clone();
    let interrupt_deadline = std::time::Instant::now() + duration;
    runtime
        .set_interrupt_handler(Some(Box::new(move || {
            interrupt_control.is_cancelled() || std::time::Instant::now() >= interrupt_deadline
        })))
        .await;
    let context = AsyncContext::full(&runtime).await.map_err(engine_error)?;
    let result = context
        .async_with(async |ctx| {
            install_globals(&ctx, session, logs.clone(), control.clone())?;
            ctx.eval::<(), _>(BOOTSTRAP_JS).catch(&ctx).map_err(|err| {
                RunError::Engine(format!(
                    "failed to initialize run runtime: {}",
                    js_error_message(&ctx, err)
                ))
            })?;

            let make_run: Function<'_> = ctx
                .globals()
                .get("__browserosMakeRunFunction")
                .catch(&ctx)
                .map_err(|err| RunError::Engine(js_error_message(&ctx, err)))?;
            let user_fn: Function<'_> = make_run
                .call((code,))
                .catch(&ctx)
                .map_err(|err| RunError::Syntax(js_error_message(&ctx, err)))?;
            let browser: Object<'_> = ctx
                .globals()
                .get("__browserosBrowser")
                .catch(&ctx)
                .map_err(|err| RunError::Engine(js_error_message(&ctx, err)))?;
            let console: Object<'_> = ctx
                .globals()
                .get("__browserosConsole")
                .catch(&ctx)
                .map_err(|err| RunError::Engine(js_error_message(&ctx, err)))?;
            let promise: Promise<'_> = match user_fn.call((browser, console)).catch(&ctx) {
                Ok(promise) => promise,
                Err(err) => {
                    if control.is_cancelled() {
                        return Err(RunError::Cancelled);
                    }
                    if control.timed_out() {
                        return Ok(RunOutcome::failure(
                            control.timeout_message.to_string(),
                            logs_snapshot(&logs),
                        ));
                    }
                    return Ok(RunOutcome::failure(
                        js_error_message(&ctx, err),
                        logs_snapshot(&logs),
                    ));
                }
            };

            match promise.into_future::<JsValue<'_>>().await.catch(&ctx) {
                Ok(value) => {
                    let (value, return_text) = json_safe_value(&ctx, value)
                        .map_err(|err| RunError::Engine(js_error_message(&ctx, err)))?;
                    Ok(RunOutcome::success(
                        value,
                        return_text,
                        logs_snapshot(&logs),
                    ))
                }
                Err(err) => {
                    if control.is_cancelled() {
                        Err(RunError::Cancelled)
                    } else if control.timed_out() {
                        Ok(RunOutcome::failure(
                            control.timeout_message.to_string(),
                            logs_snapshot(&logs),
                        ))
                    } else {
                        Ok(RunOutcome::failure(
                            js_error_message(&ctx, err),
                            logs_snapshot(&logs),
                        ))
                    }
                }
            }
        })
        .await;
    runtime.set_interrupt_handler(None).await;
    result
}

fn install_globals<'js>(
    ctx: &Ctx<'js>,
    session: Arc<browseros_core::BrowserSession>,
    logs: Arc<Mutex<Vec<String>>>,
    control: RunControl,
) -> Result<(), RunError> {
    let bridge = BrowserBridge { session, control };
    let call_bridge = {
        let bridge = bridge.clone();
        move |ctx: Ctx<'js>, method: String, args_json: String| {
            let bridge = bridge.clone();
            async move {
                match bridge.call(&method, &args_json).await {
                    Ok(BrowserCallValue::Json(value)) => json_to_js(&ctx, value),
                    Ok(BrowserCallValue::Undefined) => Ok(JsValue::new_undefined(ctx.clone())),
                    Err(message) => Err(Exception::throw_message(&ctx, &message)),
                }
            }
        }
    };
    let push_log = move |line: String| {
        push_log(&logs, line);
    };
    let globals = ctx.globals();
    globals
        .set("__browserosCall", Func::from(Async(call_bridge)))
        .catch(ctx)
        .map_err(|err| RunError::Engine(js_error_message(ctx, err)))?;
    globals
        .set("__browserosPushLog", Func::from(push_log))
        .catch(ctx)
        .map_err(|err| RunError::Engine(js_error_message(ctx, err)))?;
    Ok(())
}

impl BrowserBridge {
    async fn call(&self, method: &str, args_json: &str) -> Result<BrowserCallValue, String> {
        let args = parse_bridge_args(args_json)?;
        match method {
            "pages.list" => {
                let pages = self.control.race(self.session.pages.list()).await?;
                Ok(BrowserCallValue::Json(Value::Array(
                    pages.iter().map(page_json).collect(),
                )))
            }
            "pages.newPage" => {
                let url = string_arg(&args, 0, "url")?;
                let page_id = self
                    .control
                    .race(self.session.pages.new_page(
                        &url,
                        NewPageOptions {
                            background: None,
                            hidden: None,
                            window_id: None,
                            tab_group_id: None,
                        },
                    ))
                    .await?;
                Ok(BrowserCallValue::Json(json!(page_id.0)))
            }
            "pages.close" => {
                let page_id = page_arg(&args, 0)?;
                self.control.race(self.session.pages.close(page_id)).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "pages.getInfo" => {
                let page_id = page_arg(&args, 0)?;
                let info = self
                    .control
                    .race(async {
                        Ok(self
                            .session
                            .pages
                            .get_info(page_id)
                            .await
                            .map(|page| page_json(&page)))
                    })
                    .await?;
                Ok(BrowserCallValue::Json(info.unwrap_or(Value::Null)))
            }
            "observe.snapshot" => {
                let page_id = page_arg(&args, 0)?;
                let observer = self.session.observe(page_id).await;
                let snapshot = self.control.race(observer.snapshot()).await?;
                Ok(BrowserCallValue::Json(json!({
                    "text": snapshot.text,
                    "refs": refs_json(&snapshot.refs),
                    "url": snapshot.url,
                })))
            }
            "observe.diff" => {
                let page_id = page_arg(&args, 0)?;
                let observer = self.session.observe(page_id).await;
                let diff = self.control.race(observer.diff()).await?;
                Ok(BrowserCallValue::Json(diff_json(&diff)))
            }
            "observe.resolveRef" => {
                let page_id = page_arg(&args, 0)?;
                let ref_id = string_arg(&args, 1, "ref")?;
                let observer = self.session.observe(page_id).await;
                let resolved = self
                    .control
                    .race(observer.resolve_ref(&Ref(ref_id)))
                    .await?;
                Ok(BrowserCallValue::Json(json!({
                    "backendNodeId": resolved.backend_node_id,
                    "sessionId": resolved.session.session_id().map(ToString::to_string),
                })))
            }
            "input.click" => {
                let (page_id, ref_id) = page_ref_args(&args)?;
                let input = self.session.input(page_id).await;
                self.control
                    .race(input.click(&Ref(ref_id), Default::default()))
                    .await?;
                Ok(BrowserCallValue::Undefined)
            }
            "input.fill" => {
                let (page_id, ref_id) = page_ref_args(&args)?;
                let value = string_arg(&args, 2, "value")?;
                let input = self.session.input(page_id).await;
                self.control
                    .race(input.fill(&Ref(ref_id), &value, true))
                    .await?;
                Ok(BrowserCallValue::Undefined)
            }
            "input.type" => {
                let page_id = page_arg(&args, 0)?;
                let text = string_arg(&args, 1, "text")?;
                let input = self.session.input(page_id).await;
                self.control.race(input.type_text(&text)).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "input.press" => {
                let page_id = page_arg(&args, 0)?;
                let key = string_arg(&args, 1, "key")?;
                let input = self.session.input(page_id).await;
                self.control.race(input.press(&key)).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "input.hover" => {
                let (page_id, ref_id) = page_ref_args(&args)?;
                let input = self.session.input(page_id).await;
                self.control.race(input.hover(&Ref(ref_id))).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "input.selectOption" => {
                let (page_id, ref_id) = page_ref_args(&args)?;
                let value = string_arg(&args, 2, "value")?;
                let input = self.session.input(page_id).await;
                let selected = self
                    .control
                    .race(input.select_option(&Ref(ref_id), &value))
                    .await?;
                Ok(BrowserCallValue::Json(json!(selected)))
            }
            "input.scroll" => {
                let page_id = page_arg(&args, 0)?;
                let direction = scroll_direction(&string_arg(&args, 1, "dir")?)?;
                let amount = optional_f64_arg(&args, 2).unwrap_or(3.0).round() as i64;
                let ref_id = optional_string_arg(&args, 3)?.map(Ref);
                let input = self.session.input(page_id).await;
                self.control
                    .race(input.scroll(direction, amount, ref_id.as_ref()))
                    .await?;
                Ok(BrowserCallValue::Undefined)
            }
            "nav.goto" => {
                let page_id = page_arg(&args, 0)?;
                let url = string_arg(&args, 1, "url")?;
                let nav = self.session.nav(page_id);
                self.control.race(nav.goto(&url)).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "nav.back" => {
                let page_id = page_arg(&args, 0)?;
                let nav = self.session.nav(page_id);
                self.control.race(nav.back()).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "nav.forward" => {
                let page_id = page_arg(&args, 0)?;
                let nav = self.session.nav(page_id);
                self.control.race(nav.forward()).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "nav.reload" => {
                let page_id = page_arg(&args, 0)?;
                let nav = self.session.nav(page_id);
                self.control.race(nav.reload()).await?;
                Ok(BrowserCallValue::Undefined)
            }
            "cdp" => {
                let method = string_arg(&args, 0, "method")?;
                let params = optional_json_arg(&args, 1).unwrap_or_else(|| json!({}));
                let session_id = optional_string_arg(&args, 2)?.map(SessionId::from);
                let value = self
                    .control
                    .race(self.session.cdp(&method, params, session_id.as_ref()))
                    .await?;
                Ok(BrowserCallValue::Json(value))
            }
            "cdpJsonForPage" => {
                let page_id = page_arg(&args, 0)?;
                let method = string_arg(&args, 1, "method")?;
                let params_json = string_arg(&args, 2, "paramsJson")?;
                let raw = self
                    .control
                    .race(
                        self.session
                            .cdp_json_for_page(page_id, &method, &params_json),
                    )
                    .await?;
                let value = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
                Ok(BrowserCallValue::Json(value))
            }
            _ => Err(format!("Unknown browser method {method}")),
        }
    }
}

fn parse_bridge_args(args_json: &str) -> Result<Vec<Value>, String> {
    serde_json::from_str::<Vec<Value>>(args_json)
        .map_err(|err| format!("Invalid browser call arguments: {err}"))
}

fn page_arg(args: &[Value], index: usize) -> Result<PageId, String> {
    let raw = args
        .get(index)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("pageId argument {index} is required"))?;
    let page_id = u32::try_from(raw).map_err(|_| format!("pageId {raw} is out of range"))?;
    Ok(PageId(page_id))
}

fn page_ref_args(args: &[Value]) -> Result<(PageId, String), String> {
    Ok((page_arg(args, 0)?, string_arg(args, 1, "ref")?))
}

fn string_arg(args: &[Value], index: usize, name: &str) -> Result<String, String> {
    args.get(index)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("{name} argument is required"))
}

fn optional_string_arg(args: &[Value], index: usize) -> Result<Option<String>, String> {
    match args.get(index) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(format!("argument {index} must be a string")),
    }
}

fn optional_f64_arg(args: &[Value], index: usize) -> Option<f64> {
    args.get(index).and_then(Value::as_f64)
}

fn optional_json_arg(args: &[Value], index: usize) -> Option<Value> {
    match args.get(index) {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.clone()),
    }
}

fn scroll_direction(value: &str) -> Result<ScrollDirection, String> {
    match value {
        "up" => Ok(ScrollDirection::Up),
        "down" => Ok(ScrollDirection::Down),
        "left" => Ok(ScrollDirection::Left),
        "right" => Ok(ScrollDirection::Right),
        _ => Err(format!("Unknown scroll direction {value}")),
    }
}

fn refs_json(refs: &browseros_core::snapshot::RefMap) -> Value {
    Value::Array(
        refs.entries_in_order()
            .into_iter()
            .map(|entry| {
                let mut value = json!({
                    "ref": entry.ref_id.as_str(),
                    "backendNodeId": entry.backend_node_id,
                    "role": entry.role,
                    "name": entry.name,
                    "nth": entry.nth,
                });
                if let (Value::Object(object), Some(frame_id)) = (&mut value, &entry.frame_id) {
                    object.insert("frameId".to_string(), json!(frame_id.as_str()));
                }
                value
            })
            .collect(),
    )
}

fn diff_json(diff: &browseros_core::snapshot::SnapshotDiff) -> Value {
    let mut value = json!({
        "text": diff.text,
        "added": diff.added,
        "removed": diff.removed,
        "changed": diff.changed,
    });
    if let Value::Object(object) = &mut value {
        if let Some(before_url) = &diff.before_url {
            object.insert("beforeUrl".to_string(), json!(before_url));
        }
        if let Some(after_url) = &diff.after_url {
            object.insert("afterUrl".to_string(), json!(after_url));
        }
    }
    value
}

fn json_to_js<'js>(ctx: &Ctx<'js>, value: Value) -> rquickjs::Result<JsValue<'js>> {
    match value {
        Value::Null => Ok(JsValue::new_null(ctx.clone())),
        Value::Bool(value) => Ok(JsValue::new_bool(ctx.clone(), value)),
        Value::Number(value) => Ok(JsValue::new_number(
            ctx.clone(),
            value.as_f64().unwrap_or_default(),
        )),
        Value::String(value) => value.into_js(ctx),
        Value::Array(values) => {
            let array = Array::new(ctx.clone())?;
            for (index, value) in values.into_iter().enumerate() {
                array.set(index, json_to_js(ctx, value)?)?;
            }
            Ok(array.into_value())
        }
        Value::Object(values) => {
            let object = Object::new(ctx.clone())?;
            for (key, value) in values {
                object.set(key, json_to_js(ctx, value)?)?;
            }
            Ok(object.into_value())
        }
    }
}

fn json_safe_value<'js>(
    ctx: &Ctx<'js>,
    value: JsValue<'js>,
) -> rquickjs::CaughtResult<'js, (Option<Value>, Option<String>)> {
    let encode: Function<'_> = ctx.globals().get("__browserosJsonSafeString").catch(ctx)?;
    let encoded: Option<String> = encode.call((value.clone(),)).catch(ctx)?;
    let Some(encoded) = encoded else {
        return Ok((None, None));
    };
    let display: Function<'_> = ctx.globals().get("__browserosSafeStringify").catch(ctx)?;
    let return_text: String = display.call((value,)).catch(ctx)?;
    let value = serde_json::from_str(&encoded).map_err(|err| {
        CaughtError::Error(rquickjs::Error::new_from_js_message(
            "string",
            "JSON",
            err.to_string(),
        ))
    })?;
    Ok((Some(value), Some(return_text)))
}

fn js_error_message<'js>(ctx: &Ctx<'js>, error: CaughtError<'js>) -> String {
    match error {
        CaughtError::Error(error) => error.to_string(),
        CaughtError::Exception(exception) => {
            exception.message().unwrap_or_else(|| exception.to_string())
        }
        CaughtError::Value(value) => js_value_string(ctx, value),
    }
}

fn js_value_string<'js>(ctx: &Ctx<'js>, value: JsValue<'js>) -> String {
    if value.is_undefined() {
        return "undefined".to_string();
    }
    if value.is_null() {
        return "null".to_string();
    }
    if let Some(value) = value.as_bool() {
        return value.to_string();
    }
    if let Some(value) = value.as_number() {
        return value.to_string();
    }
    if let Ok(value) = String::from_js(ctx, value.clone()) {
        return value;
    }
    let string_constructor: rquickjs::Result<Function<'_>> = ctx.globals().get("String");
    match string_constructor.and_then(|func| func.call((value,))) {
        Ok(value) => value,
        Err(err) => err.to_string(),
    }
}

fn format_outcome(outcome: &RunOutcome) -> String {
    let mut sections = Vec::new();
    if let Some(error) = &outcome.error {
        sections.push(format!("error: {error}"));
    } else {
        sections.push("ok".to_string());
        if let Some(value) = &outcome.return_text {
            sections.push(format!("return: {value}"));
        }
    }
    if !outcome.logs.is_empty() {
        sections.push(format!("logs:\n{}", outcome.logs.join("\n")));
    }
    sections.join("\n")
}

fn timeout_duration(timeout_ms: f64) -> Duration {
    if !timeout_ms.is_finite() || timeout_ms <= 0.0 {
        Duration::from_millis(1)
    } else {
        Duration::from_secs_f64(timeout_ms / 1000.0)
    }
}

fn logs_snapshot(logs: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
    logs.lock()
        .map(|logs| logs.clone())
        .unwrap_or_else(|_| Vec::new())
}

fn push_log(logs: &Arc<Mutex<Vec<String>>>, line: String) {
    if let Ok(mut logs) = logs.lock() {
        logs.push(line);
    }
}

fn engine_error(error: rquickjs::Error) -> RunError {
    RunError::Engine(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        framework::{BrowserToolDefaults, BrowserToolOptions, ToolCtx, execute_tool},
        output_file::create_browser_output_file_access,
    };
    use browseros_cdp::{CdpError, CdpEvent};
    use browseros_core::{BrowserSession, BrowserSessionHooks, CdpConnection};
    use futures_util::future::BoxFuture;
    use serde_json::json;
    use tokio::sync::broadcast;
    use tokio_util::sync::CancellationToken;

    struct RunFakeConnection {
        sender: broadcast::Sender<CdpEvent>,
    }

    impl RunFakeConnection {
        fn new() -> Self {
            let (sender, _receiver) = broadcast::channel(8);
            Self { sender }
        }
    }

    impl CdpConnection for RunFakeConnection {
        fn send<'a>(
            &'a self,
            method: &'a str,
            _params: Value,
            _session: Option<&'a SessionId>,
        ) -> BoxFuture<'a, Result<Value, CdpError>> {
            Box::pin(async move {
                match method {
                    "Browser.getTabs" => Ok(json!({
                        "tabs": [{
                            "tabId": 7,
                            "targetId": "target-7",
                            "url": "https://example.com",
                            "title": "Example",
                            "isActive": true,
                            "isLoading": false,
                            "loadProgress": 1.0,
                            "isPinned": false,
                            "isHidden": false,
                            "windowId": 1,
                            "index": 0
                        }]
                    })),
                    _ => Err(CdpError::Protocol {
                        code: -1,
                        message: format!("unexpected fake CDP call: {method}"),
                    }),
                }
            })
        }

        fn send_raw_json<'a>(
            &'a self,
            method: &'a str,
            _params_json: &'a str,
            _session: Option<&'a SessionId>,
        ) -> BoxFuture<'a, Result<String, CdpError>> {
            Box::pin(async move {
                Err(CdpError::Protocol {
                    code: -1,
                    message: format!("unexpected fake CDP raw call: {method}"),
                })
            })
        }

        fn events(&self) -> broadcast::Receiver<CdpEvent> {
            self.sender.subscribe()
        }

        fn is_connected(&self) -> bool {
            true
        }

        fn connection_epoch(&self) -> u64 {
            1
        }
    }

    fn test_ctx() -> ToolCtx {
        ToolCtx::new(BrowserToolOptions {
            session: BrowserSession::new(
                Arc::new(RunFakeConnection::new()),
                BrowserSessionHooks::default(),
            ),
            defaults: BrowserToolDefaults::default(),
            cancel: CancellationToken::new(),
            output_files: create_browser_output_file_access(),
        })
    }

    async fn run_tool(code: &str, timeout: Option<f64>) -> anyhow::Result<ToolResult> {
        let mut args = json!({ "code": code });
        if let (Value::Object(object), Some(timeout)) = (&mut args, timeout) {
            object.insert("timeout".to_string(), json!(timeout));
        }
        let def = definition();
        execute_tool(&def, args, &test_ctx())
            .await
            .map_err(|err| anyhow::anyhow!(err.to_string()))
    }

    #[tokio::test]
    async fn run_returns_json_safe_value() -> anyhow::Result<()> {
        let result = run_tool("return 1 + 1", None).await?;
        assert!(!result.is_error);
        assert_eq!(
            result.structured_content,
            Some(json!({
                "ok": true,
                "value": 2,
                "logs": []
            }))
        );
        let text = result_text(&result)?;
        assert!(text.contains("ok"));
        assert!(text.contains("return: 2"));
        Ok(())
    }

    #[tokio::test]
    async fn run_captures_console_output() -> anyhow::Result<()> {
        let result = run_tool(
            r#"
console.log('a', { b: 1 });
console.info('i');
console.warn('w');
console.error('e');
return undefined;
"#,
            None,
        )
        .await?;
        assert!(!result.is_error);
        assert_eq!(
            result.structured_content,
            Some(json!({
                "ok": true,
                "logs": [
                    "a {\n  \"b\": 1\n}",
                    "i",
                    "warn: w",
                    "error: e"
                ]
            }))
        );
        Ok(())
    }

    #[tokio::test]
    async fn run_reports_runtime_exception_as_structured_error() -> anyhow::Result<()> {
        let result = run_tool(
            r#"
console.log('before');
throw new Error('boom');
"#,
            None,
        )
        .await?;
        assert!(result.is_error);
        assert_eq!(
            result.structured_content,
            Some(json!({
                "ok": false,
                "logs": ["before"],
                "error": "boom"
            }))
        );
        let text = result_text(&result)?;
        assert!(text.contains("error: boom"));
        Ok(())
    }

    #[tokio::test]
    async fn run_reports_timeout_with_logs_so_far() -> anyhow::Result<()> {
        let result = run_tool(
            r#"
console.log('before');
while (true) {}
"#,
            Some(10.0),
        )
        .await?;
        assert!(result.is_error);
        assert_eq!(
            result.structured_content,
            Some(json!({
                "ok": false,
                "logs": ["before"],
                "error": "run exceeded 10ms"
            }))
        );
        Ok(())
    }

    #[tokio::test]
    async fn run_proxies_browser_pages_list() -> anyhow::Result<()> {
        let result = run_tool(
            r#"
const pages = await browser.pages.list();
return pages.map((page) => ({
  pageId: page.pageId,
  tabId: page.tabId,
  url: page.url,
  title: page.title,
}));
"#,
            None,
        )
        .await?;
        assert!(!result.is_error);
        assert_eq!(
            result.structured_content,
            Some(json!({
                "ok": true,
                "value": [{
                    "pageId": 1,
                    "tabId": 7,
                    "url": "https://example.com",
                    "title": "Example"
                }],
                "logs": []
            }))
        );
        Ok(())
    }

    fn result_text(result: &ToolResult) -> anyhow::Result<&str> {
        result
            .content
            .first()
            .and_then(|content| content.as_text())
            .map(|content| content.text.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing text result"))
    }
}
