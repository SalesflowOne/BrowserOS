use crate::{
    app::AppState,
    dispatch::pipeline::{DispatchCtx, ToolHooks, extract_page_id},
    domain::AgentRef,
    services::agents::ApprovalVerdict,
};
use browseros_core::PageId;
use browseros_mcp::framework::ToolResult;
use serde_json::Value;
use url::Url;

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

pub struct PermissionGuard;

impl PermissionGuard {
    pub async fn check(
        state: &AppState,
        ctx: &DispatchCtx<'_>,
        hooks: &ToolHooks,
    ) -> Option<ToolResult> {
        let profile_id = ctx.session.agent().profile_id()?;
        let profile = match state.agents.load_by_id(profile_id.as_str()).await {
            Ok(Some(profile)) => profile,
            Ok(None) => {
                return Some(ToolResult::error(
                    "stored agent profile was not found; refusing dispatch",
                ));
            }
            Err(err) => {
                tracing::warn!(error = %err, "permission guard profile load failed");
                return Some(ToolResult::error(
                    "stored agent profile could not be loaded; refusing dispatch",
                ));
            }
        };
        let verdict = profile.approvals.get(hooks.permission_verb);
        match verdict {
            Some(ApprovalVerdict::Block) => Some(ToolResult::error(format!(
                "blocked by agent approval profile: {} on {}",
                ctx.tool.name,
                domain_for_call(ctx.tool.name, ctx.raw_args, &profile.selected_sites)
            ))),
            Some(ApprovalVerdict::Ask) => Some(ToolResult::error(format!(
                "approval required for verb {}; interactive approvals are not available in this Rust phase, so the dispatch was blocked",
                hooks.permission_verb
            ))),
            Some(ApprovalVerdict::Auto) | None => None,
        }
    }
}

fn domain_for_call(tool_name: &str, raw_args: &Value, selected_sites: &[String]) -> String {
    if tool_name == "navigate"
        && let Some(url) = raw_args.get("url").and_then(Value::as_str)
        && let Ok(parsed) = Url::parse(url)
        && let Some(host) = parsed.host_str()
    {
        return host.to_string();
    }
    selected_sites
        .first()
        .cloned()
        .unwrap_or_else(|| "*".to_string())
}

#[must_use]
pub fn is_profile_agent(agent: &AgentRef) -> bool {
    agent.profile_id().is_some()
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
