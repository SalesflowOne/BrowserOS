use crate::{
    app::AppState,
    dispatch::pipeline::{DispatchCtx, extract_page_id},
};
use browseros_core::PageId;
use browseros_mcp::framework::ToolResult;
use serde_json::Value;

const NAVIGATE_BLOCKED_SCHEMES: &[&str] = &["javascript", "file", "data"];

pub struct BrowserConnectedGuard;

impl BrowserConnectedGuard {
    pub fn check(ctx: &DispatchCtx<'_>) -> Option<ToolResult> {
        if ctx.browser_session.is_some() {
            None
        } else {
            Some(ToolResult::error(
                "browser not connected (retrying); try again once BrowserOS reconnects",
            ))
        }
    }
}

pub struct NavigateSchemeGuard;

impl NavigateSchemeGuard {
    pub fn check(ctx: &DispatchCtx<'_>) -> Option<ToolResult> {
        if ctx.tool.name != "navigate" {
            return None;
        }
        let url = ctx.raw_args.get("url").and_then(Value::as_str)?;
        let (scheme, _rest) = url.split_once(':')?;
        let scheme = scheme.to_ascii_lowercase();
        if NAVIGATE_BLOCKED_SCHEMES.contains(&scheme.as_str()) {
            return Some(ToolResult::error(format!(
                "navigate refuses {scheme}: URLs; only http(s) is allowed"
            )));
        }
        None
    }
}

pub struct PageOwnershipGuard;

impl PageOwnershipGuard {
    pub async fn check(state: &AppState, ctx: &DispatchCtx<'_>) -> Option<ToolResult> {
        if !ctx.hooks.accepts_page_arg {
            return None;
        }
        let page_id = extract_page_id(ctx.tool.name, ctx.raw_args)?;
        let page_id = PageId(page_id);
        match state.sessions.owner_of_page(&page_id).await {
            Some(owner) if owner != *ctx.session.id() => Some(ToolResult::error(format!(
                "page {} is not owned by this agent; call `tabs` with action=\"new\" to open a fresh page and use the returned page id.",
                page_id.0
            ))),
            Some(_) => None,
            None => {
                ctx.session.add_owned_page(page_id).await;
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{BrowserConnectedGuard, NavigateSchemeGuard};
    use crate::dispatch::pipeline::{DispatchCtx, ToolHooks};
    use browseros_mcp::catalog;
    use serde_json::json;

    #[test]
    fn navigate_scheme_blocks_javascript_urls() {
        let tools = catalog();
        let tool = tools
            .iter()
            .find(|tool| tool.name == "navigate")
            .ok_or("missing navigate")
            .unwrap_or_else(|_| unreachable!());
        let hooks = ToolHooks::for_tool(tool.name);
        let ctx = DispatchCtx::for_test(
            tool,
            json!({"page": 1, "url": "javascript:alert(1)"}),
            hooks,
        );
        let result = NavigateSchemeGuard::check(&ctx);
        assert!(result.is_some());
    }

    #[test]
    fn browser_connected_guard_returns_tool_error() {
        let tools = catalog();
        let tool = tools
            .iter()
            .find(|tool| tool.name == "tabs")
            .ok_or("missing tabs")
            .unwrap_or_else(|_| unreachable!());
        let hooks = ToolHooks::for_tool(tool.name);
        let ctx = DispatchCtx::for_test(tool, json!({"action": "list"}), hooks);
        let result = BrowserConnectedGuard::check(&ctx);
        assert!(result.is_some_and(|result| result.is_error));
    }
}
