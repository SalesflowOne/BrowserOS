use crate::{
    app::AppState,
    dispatch::{
        guards::{BrowserConnectedGuard, NavigateSchemeGuard, PageOwnershipGuard},
        observers::{ObserverRunner, apply_post_execution_hooks},
    },
    domain::{DispatchId, Session},
};
use browseros_core::BrowserSession;
use browseros_mcp::{
    BrowserToolDefaults, BrowserToolOptions, ToolCtx, ToolDef, execute_tool,
    framework::{ToolError, ToolResult},
    output_file::create_browser_output_file_access,
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Instant};
use tokio_util::sync::CancellationToken;
use tracing::{Instrument, info_span};

pub struct DispatchInput<'a> {
    pub session: Arc<Session>,
    pub tool: &'a ToolDef,
    pub raw_args: Value,
    pub browser_session: Option<Arc<BrowserSession>>,
}

pub struct DispatchPipeline {
    state: AppState,
}

pub struct DispatchCtx<'a> {
    pub session: Arc<Session>,
    pub dispatch_id: DispatchId,
    pub tool: &'a ToolDef,
    pub raw_args: &'a Value,
    pub browser_session: Option<Arc<BrowserSession>>,
    pub cancel: CancellationToken,
    pub hooks: ToolHooks,
}

#[derive(Debug, Clone, Copy)]
pub struct DispatchTiming {
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct ToolHooks {
    pub accepts_page_arg: bool,
    pub filter_tabs_list: bool,
    pub capture_new_page: bool,
    pub close_page: bool,
}

#[derive(Debug, Clone, Copy)]
struct HookSpec {
    name: &'static str,
    accepts_page_arg: bool,
}

const HOOKS: &[HookSpec] = &[
    HookSpec {
        name: "tabs",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "tab_groups",
        accepts_page_arg: false,
    },
    HookSpec {
        name: "navigate",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "snapshot",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "diff",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "act",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "download",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "upload",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "read",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "grep",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "screenshot",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "pdf",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "wait",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "windows",
        accepts_page_arg: false,
    },
    HookSpec {
        name: "evaluate",
        accepts_page_arg: true,
    },
    HookSpec {
        name: "run",
        accepts_page_arg: false,
    },
];

impl ToolHooks {
    #[must_use]
    pub fn for_tool(name: &str) -> Self {
        let spec = HOOKS
            .iter()
            .find(|hook| hook.name == name)
            .copied()
            .unwrap_or(HookSpec {
                name: "",
                accepts_page_arg: false,
            });
        let (filter_tabs_list, capture_new_page, close_page) =
            tabs_action_flags(name, &Value::Null);
        Self {
            accepts_page_arg: spec.accepts_page_arg,
            filter_tabs_list,
            capture_new_page,
            close_page,
        }
    }

    fn for_call(name: &str, raw_args: &Value) -> Self {
        let mut hooks = Self::for_tool(name);
        let (filter_tabs_list, capture_new_page, close_page) = tabs_action_flags(name, raw_args);
        hooks.filter_tabs_list = filter_tabs_list;
        hooks.capture_new_page = capture_new_page;
        hooks.close_page = close_page;
        hooks
    }
}

impl DispatchPipeline {
    #[must_use]
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn dispatch(&self, input: DispatchInput<'_>) -> ToolResult {
        let dispatch_id = DispatchId::new();
        let hooks = ToolHooks::for_call(input.tool.name, &input.raw_args);
        let cancel = input.session.child_token();
        input
            .session
            .register_dispatch(dispatch_id.clone(), cancel.clone())
            .await;
        let ctx = DispatchCtx {
            session: input.session.clone(),
            dispatch_id: dispatch_id.clone(),
            tool: input.tool,
            raw_args: &input.raw_args,
            browser_session: input.browser_session,
            cancel: cancel.clone(),
            hooks,
        };
        let span = info_span!(
            "mcp_dispatch",
            session_id = %ctx.session.id(),
            dispatch_id = %ctx.dispatch_id,
            agent = %ctx.session.agent().agent_id(),
            tool = %ctx.tool.name
        );
        let result = async {
            let started = Instant::now();
            let output_files = create_browser_output_file_access();
            let mut result = self.run_guards_and_tool(&ctx, output_files.clone()).await;
            apply_post_execution_hooks(&ctx, &result).await;
            let duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
            ObserverRunner::run(
                &self.state,
                &ctx,
                &mut result,
                DispatchTiming { duration_ms },
                output_files,
            )
            .await;
            result
        }
        .instrument(span)
        .await;
        ctx.session.unregister_dispatch(&dispatch_id).await;
        result
    }

    async fn run_guards_and_tool(
        &self,
        ctx: &DispatchCtx<'_>,
        output_files: browseros_mcp::framework::OutputFileAccess,
    ) -> ToolResult {
        if let Some(result) = NavigateSchemeGuard::check(ctx) {
            return result;
        }
        if let Some(result) = BrowserConnectedGuard::check(ctx) {
            return result;
        }
        if let Some(result) = PageOwnershipGuard::check(&self.state, ctx).await {
            return result;
        }
        let Some(browser_session) = &ctx.browser_session else {
            return ToolResult::error(
                "browser not connected (retrying); try again once BrowserOS reconnects",
            );
        };
        let tool_ctx = ToolCtx::new(BrowserToolOptions {
            session: browser_session.clone(),
            defaults: BrowserToolDefaults::default(),
            cancel: ctx.cancel.clone(),
            output_files,
        });
        match execute_tool(ctx.tool, ctx.raw_args.clone(), &tool_ctx).await {
            Ok(result) => result,
            Err(ToolError::Cancelled) => cancellation_result("The operation was aborted."),
            Err(err) => ToolResult::error(format!("{} failed: {err}", ctx.tool.name)),
        }
    }
}

impl<'a> DispatchCtx<'a> {
    #[cfg(test)]
    pub fn for_test(tool: &'a ToolDef, raw_args: Value, hooks: ToolHooks) -> Self {
        Self {
            session: Session::new(
                crate::domain::SessionId::new("test-session"),
                crate::domain::AgentRef::Ephemeral {
                    agent_id: crate::domain::AgentId::new("test-agent"),
                    slug: "test".to_string(),
                    label: "Test".to_string(),
                },
                tokio::time::Instant::now(),
            ),
            dispatch_id: DispatchId::new(),
            tool,
            raw_args: Box::leak(Box::new(raw_args)),
            browser_session: None,
            cancel: CancellationToken::new(),
            hooks,
        }
    }
}

#[must_use]
pub fn cancellation_result(reason: &str) -> ToolResult {
    ToolResult {
        content: vec![rmcp::model::ContentBlock::text(reason)],
        is_error: true,
        structured_content: Some(json!({
            "cancellationReason": reason,
            "cancellationKind": "cockpit.operator-cancelled"
        })),
    }
}

#[must_use]
pub fn extract_page_id(tool_name: &str, raw_args: &Value) -> Option<u32> {
    if !accepts_page_arg(tool_name) {
        return None;
    }
    raw_args
        .get("page")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value >= 1)
}

#[must_use]
pub fn result_page_id(result: &ToolResult) -> Option<u32> {
    result
        .structured_content
        .as_ref()
        .and_then(|value| value.get("page"))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value >= 1)
}

fn accepts_page_arg(name: &str) -> bool {
    HOOKS
        .iter()
        .find(|hook| hook.name == name)
        .map(|hook| hook.accepts_page_arg)
        .unwrap_or(false)
}

fn tabs_action_flags(name: &str, raw_args: &Value) -> (bool, bool, bool) {
    if name != "tabs" {
        return (false, false, false);
    }
    let action = raw_args
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("list");
    (action == "list", action == "new", action == "close")
}

#[cfg(test)]
mod tests {
    use super::{ToolHooks, cancellation_result};

    #[test]
    fn hook_table_maps_tabs_new() {
        let hooks = ToolHooks::for_call("tabs", &serde_json::json!({ "action": "new" }));
        assert!(hooks.capture_new_page);
        assert!(!hooks.filter_tabs_list);
    }

    #[test]
    fn cancellation_shape_matches_contract() {
        let result = cancellation_result("stop");
        assert!(result.is_error);
        assert_eq!(
            result
                .structured_content
                .and_then(|value| value.get("cancellationKind").cloned()),
            Some(serde_json::json!("cockpit.operator-cancelled"))
        );
    }
}
