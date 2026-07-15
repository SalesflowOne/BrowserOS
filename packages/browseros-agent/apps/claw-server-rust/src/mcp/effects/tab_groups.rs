use crate::{
    domain::{AgentKey, AgentPageOwnership, color_for_slug},
    mcp::{
        dispatch::{ToolEffect, ToolEffectContext, result_page_id},
        naming::desired_group_title,
    },
};
use browseros_core::{BrowserSession, PageId};
use browseros_mcp::{
    BrowserToolDefaults, BrowserToolOptions, OutputFileAccess, ToolCtx, ToolResult, catalog,
    execute_tool,
};
use futures_util::future::BoxFuture;
use rmcp::model::ContentBlock;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::warn;

/// Creates or joins the durable tab group for a successful `tabs new` call.
pub fn apply(context: ToolEffectContext<'_>) -> BoxFuture<'_, anyhow::Result<Option<ToolResult>>> {
    Box::pin(async move {
        if context.result.is_error {
            return Ok(None);
        }
        let (Some(identity), Some(browser)) = (
            context.call.identity.as_ref(),
            context.call.browser_session.as_ref(),
        ) else {
            return Ok(None);
        };
        let ownership = context.call.state.sessions.ownership();
        expand_agent_tab_group(
            browser,
            &ownership,
            &identity.ownership_key,
            context.call.cancel.clone(),
            context.call.output_files.clone(),
        )
        .await;
        if !context.call.flags.new_page {
            return Ok(None);
        }
        let Some(page_id) = result_page_id(context.result) else {
            return Ok(None);
        };
        if let Some(default_group_id) = &context.call.default_tab_group_id {
            let page_group_id = browser
                .pages
                .get_info(PageId(page_id))
                .await
                .and_then(|page| page.group_id);
            if page_group_id.as_ref() == Some(default_group_id) {
                return Ok(None);
            }
            ownership
                .set_tab_group_ref(identity.ownership_key.clone(), None)
                .await;
        }
        let group_id = ownership.tab_group_ref(&identity.ownership_key).await;
        let color = ownership
            .tab_group_color(&identity.ownership_key)
            .await
            .unwrap_or_else(|| color_for_slug(identity.agent.slug()));
        let (args, creation_title) = if let Some(group_id) = group_id {
            (
                json!({ "action": "create", "groupId": group_id, "pages": [page_id] }),
                None,
            )
        } else {
            let title = desired_group_title(&identity.session).await;
            (
                json!({ "action": "create", "pages": [page_id], "title": title }),
                Some(title),
            )
        };
        let group_result = match dispatch_tab_groups(
            browser,
            context.call.cancel.clone(),
            context.call.output_files.clone(),
            args,
        )
        .await
        {
            Ok(result) => result,
            Err(reason) => {
                warn!(
                    dispatch_id = %context.call.dispatch_id,
                    error = %reason,
                    "tab group orchestration failed"
                );
                return Ok(None);
            }
        };
        let Some(group_id) = result_group_id(&group_result) else {
            return Ok(None);
        };
        ownership
            .set_tab_group(
                identity.ownership_key.clone(),
                Some(group_id.clone()),
                Some(color),
            )
            .await;
        let Some(creation_title) = creation_title else {
            return Ok(None);
        };
        if let Err(reason) = dispatch_tab_groups(
            browser,
            context.call.cancel.clone(),
            context.call.output_files.clone(),
            json!({ "action": "update", "groupId": group_id, "color": color }),
        )
        .await
        {
            warn!(
                dispatch_id = %context.call.dispatch_id,
                group_color = %color,
                error = %reason,
                "tab group color lock failed"
            );
        }
        let desired_title = desired_group_title(&identity.session).await;
        if desired_title != creation_title
            && let Err(reason) = dispatch_tab_groups(
                browser,
                context.call.cancel.clone(),
                context.call.output_files.clone(),
                json!({ "action": "update", "groupId": group_id, "title": desired_title }),
            )
            .await
        {
            warn!(
                dispatch_id = %context.call.dispatch_id,
                error = %reason,
                "tab group late title apply failed"
            );
        }
        Ok(None)
    })
}

/// Collapses the durable group after its final live session ends.
pub async fn collapse_agent_tab_group(
    browser: &Arc<BrowserSession>,
    ownership: &Arc<AgentPageOwnership>,
    key: &AgentKey,
) {
    if ownership.tab_group_collapsed(key).await {
        return;
    }
    let Some(group_id) = ownership.tab_group_ref(key).await else {
        return;
    };
    match dispatch_tab_groups(
        browser,
        CancellationToken::new(),
        browseros_mcp::output_file::create_browser_output_file_access(),
        json!({ "action": "update", "groupId": group_id, "collapsed": true }),
    )
    .await
    {
        Ok(_) => {
            ownership.set_tab_group_collapsed(key.clone(), true).await;
        }
        Err(reason) => warn!(key = %key, error = %reason, "agent tab group collapse failed"),
    }
}

async fn expand_agent_tab_group(
    browser: &Arc<BrowserSession>,
    ownership: &Arc<AgentPageOwnership>,
    key: &AgentKey,
    cancel: CancellationToken,
    output_files: OutputFileAccess,
) {
    if !ownership.tab_group_collapsed(key).await {
        return;
    }
    let Some(group_id) = ownership.tab_group_ref(key).await else {
        return;
    };
    match dispatch_tab_groups(
        browser,
        cancel,
        output_files,
        json!({ "action": "update", "groupId": group_id, "collapsed": false }),
    )
    .await
    {
        Ok(_) => {
            ownership.set_tab_group_collapsed(key.clone(), false).await;
        }
        Err(reason) => warn!(key = %key, error = %reason, "agent tab group expand failed"),
    }
}

/// Applies a completed session name to the durable group when it exists.
pub async fn retitle_agent_tab_group(
    browser: &Arc<BrowserSession>,
    ownership: &Arc<AgentPageOwnership>,
    key: &AgentKey,
    title: &str,
    cancel: CancellationToken,
) {
    let Some(group_id) = ownership.tab_group_ref(key).await else {
        return;
    };
    if let Err(reason) = dispatch_tab_groups(
        browser,
        cancel,
        browseros_mcp::output_file::create_browser_output_file_access(),
        json!({ "action": "update", "groupId": group_id, "title": title }),
    )
    .await
    {
        warn!(key = %key, error = %reason, "session name tab group retitle failed");
    }
}

async fn dispatch_tab_groups(
    browser: &Arc<BrowserSession>,
    cancel: CancellationToken,
    output_files: OutputFileAccess,
    args: Value,
) -> Result<ToolResult, String> {
    let Some(tab_groups) = catalog().into_iter().find(|tool| tool.name == "tab_groups") else {
        return Err("tab_groups tool missing from catalog".to_string());
    };
    let ctx = ToolCtx::new(BrowserToolOptions {
        session: browser.clone(),
        defaults: BrowserToolDefaults::default(),
        cancel,
        output_files,
    });
    match execute_tool(&tab_groups, args, &ctx).await {
        Ok(result) if !result.is_error => Ok(result),
        Ok(result) => Err(first_text(&result)),
        Err(error) => Err(error.to_string()),
    }
}

fn result_group_id(result: &ToolResult) -> Option<String> {
    result
        .structured_content
        .as_ref()
        .and_then(|value| value.get("group"))
        .and_then(|value| value.get("groupId"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn first_text(result: &ToolResult) -> String {
    result
        .content
        .iter()
        .find_map(|block| match block {
            ContentBlock::Text(text) => Some(text.text.clone()),
            _ => None,
        })
        .unwrap_or_default()
}

const _: ToolEffect = apply;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_text_returns_empty_when_result_has_no_text() {
        let result = ToolResult::image("aGVsbG8=", "image/jpeg", json!({}));
        assert!(first_text(&result).is_empty());
    }
}
