use crate::mcp::dispatch::{ToolEffect, ToolEffectContext};
use browseros_core::PageId;
use browseros_mcp::ToolResult;
use futures_util::future::BoxFuture;
use rmcp::model::ContentBlock;
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// Replaces successful tabs-list results with the caller's ownership view.
pub fn apply(context: ToolEffectContext<'_>) -> BoxFuture<'_, anyhow::Result<Option<ToolResult>>> {
    Box::pin(async move {
        if context.result.is_error || !context.call.flags.list_tabs {
            return Ok(None);
        }
        let Some(identity) = &context.call.identity else {
            return Ok(None);
        };
        let Some(Value::Object(structured)) = context.result.structured_content.as_ref() else {
            return Ok(None);
        };
        let Some(pages) = structured.get("pages").and_then(Value::as_array) else {
            return Ok(None);
        };
        let live_page_ids = pages
            .iter()
            .filter_map(page_id)
            .map(PageId)
            .collect::<BTreeSet<_>>();
        let ownership = context.call.state.sessions.ownership();
        for stale_page in ownership.prune_missing_pages(&live_page_ids).await {
            identity.session.forget_first_capture(&stale_page).await;
        }
        let owned = ownership.owned_pages(&identity.ownership_key).await;
        let surviving = pages
            .iter()
            .filter(|page| page_id(page).is_some_and(|page| owned.contains(&PageId(page))))
            .cloned()
            .collect::<Vec<_>>();
        let lines = surviving
            .iter()
            .filter_map(format_tab_line)
            .collect::<Vec<_>>();
        Ok(Some(ToolResult {
            content: vec![ContentBlock::text(if lines.is_empty() {
                "(no open pages)".to_string()
            } else {
                lines.join("\n")
            })],
            structured_content: Some(json!({ "pages": surviving })),
            is_error: false,
        }))
    })
}

fn page_id(page: &Value) -> Option<u32> {
    page.get("page")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn format_tab_line(page: &Value) -> Option<String> {
    let page_id = page.get("page").and_then(Value::as_u64)?;
    let url = page.get("url").and_then(Value::as_str).unwrap_or_default();
    let title = page
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if title.is_empty() {
        Some(format!("[{page_id}] {url}"))
    } else {
        Some(format!("[{page_id}] {url} ({title})"))
    }
}

const _: ToolEffect = apply;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn filters_tabs_to_pages_owned_by_same_key() -> anyhow::Result<()> {
        let call = crate::mcp::test_support::tool_call("tabs", json!({ "action": "list" })).await?;
        let identity = call.identity.as_ref().unwrap_or_else(|| unreachable!());
        call.state
            .sessions
            .ownership()
            .claim_page(identity.ownership_key.clone(), PageId(2))
            .await;
        call.state
            .sessions
            .ownership()
            .claim_page(crate::domain::AgentKey::new("other"), PageId(3))
            .await;
        let result = ToolResult::text(
            "all tabs",
            Some(json!({
                "pages": [
                    { "page": 2, "url": "https://owned.test", "title": "Owned" },
                    { "page": 3, "url": "https://other.test", "title": "Other" }
                ]
            })),
        );
        let filtered = apply(ToolEffectContext {
            call: &call,
            result: &result,
            cancelled: false,
            duration_ms: 1,
        })
        .await
        .unwrap_or_else(|error| panic!("effect failed: {error}"))
        .unwrap_or(result);
        assert_eq!(
            filtered.structured_content,
            Some(json!({
                "pages": [{ "page": 2, "url": "https://owned.test", "title": "Owned" }]
            }))
        );
        Ok(())
    }
}
