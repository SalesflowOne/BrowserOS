use crate::{
    mcp::dispatch::{ToolCall, ToolEffect, ToolEffectContext, extract_page_id, result_page_id},
    services::audit::{DispatchResultSummary, RecordToolDispatchInput},
};
use base64::Engine;
use browseros_core::PageId;
use browseros_mcp::ToolResult;
use futures_util::future::BoxFuture;
use rmcp::model::ContentBlock;
use serde_json::{Value, json};
use tracing::warn;

const READ_ONLY_TOOLS: &[&str] = &["snapshot", "read", "grep", "diff", "wait"];

#[derive(Debug, Clone, Copy)]
struct AuditRecord {
    row_id: i64,
}

/// Persists cancelled or successful dispatches and their screenshot metadata.
pub fn apply(context: ToolEffectContext<'_>) -> BoxFuture<'_, anyhow::Result<Option<ToolResult>>> {
    Box::pin(async move {
        if !context.cancelled && context.result.is_error {
            return Ok(None);
        }
        let Some(identity) = &context.call.identity else {
            if !context.cancelled {
                warn!(
                    tool = context.call.tool().name,
                    session_id = %context.call.session_id,
                    "cockpit dispatch missing identity"
                );
            }
            return Ok(None);
        };
        let Some(record) = record_dispatch(
            context.call,
            context.result,
            context.duration_ms,
            context.cancelled,
            identity,
        )
        .await
        else {
            return Ok(None);
        };
        if !context.cancelled {
            persist_screenshot(context.call, context.result, record, identity).await;
        }
        Ok(None)
    })
}

async fn record_dispatch(
    call: &ToolCall,
    result: &ToolResult,
    duration_ms: i64,
    cancelled: bool,
    identity: &crate::mcp::dispatch::ToolIdentity,
) -> Option<AuditRecord> {
    let page_id = extract_page_id(call);
    let live = match (&call.browser_session, page_id) {
        (Some(browser), Some(page_id)) => browser.pages.get_info(PageId(page_id)).await,
        _ => None,
    };
    let content = serde_json::to_value(&result.content).unwrap_or_else(|error| {
        warn!(error = %error, "tool content serialization failed");
        json!([])
    });
    let structured_content = result.structured_content.clone().unwrap_or(Value::Null);
    match call
        .state
        .audit
        .record_tool_dispatch(RecordToolDispatchInput {
            agent_id: identity.agent.agent_id().as_str().to_string(),
            slug: identity.agent.slug().to_string(),
            agent_label: identity.agent_label.clone(),
            session_id: call.session_id.as_str().to_string(),
            tool_name: call.tool().name.to_string(),
            page_id: page_id.map(i64::from),
            target_id: live
                .as_ref()
                .map(|page| page.target_id.as_str().to_string()),
            url: live.as_ref().map(|page| page.url.clone()),
            title: live.as_ref().map(|page| page.title.clone()),
            raw_args: call.raw_args.clone(),
            duration_ms,
            dispatch_id: call.dispatch_id.clone(),
            result: DispatchResultSummary {
                is_error: cancelled || result.is_error,
                structured_content,
                content,
            },
        })
        .await
    {
        Ok(row_id) => Some(AuditRecord { row_id }),
        Err(error) => {
            warn!(
                error = %error,
                dispatch_id = %call.dispatch_id,
                "audit writer failed"
            );
            None
        }
    }
}

async fn persist_screenshot(
    call: &ToolCall,
    result: &ToolResult,
    record: AuditRecord,
    identity: &crate::mcp::dispatch::ToolIdentity,
) {
    let screenshot_page_id = if call.flags.new_page {
        result_page_id(result)
    } else {
        extract_page_id(call)
    };
    for image in result.content.iter().filter_map(image_data) {
        match base64::engine::general_purpose::STANDARD.decode(image.as_bytes()) {
            Ok(bytes) if !bytes.is_empty() => {
                if write_screenshot_files(call, record, &bytes).await {
                    if let Some(page_id) = screenshot_page_id {
                        identity
                            .session
                            .mark_first_capture_done(PageId(page_id))
                            .await;
                    }
                    return;
                }
            }
            Ok(_) => {}
            Err(error) => warn!(
                error = %error,
                dispatch_id = %call.dispatch_id,
                "tool-result image decode failed"
            ),
        }
    }
    if !call.state.config.screencast_screenshot_fallback {
        return;
    }
    let Some(page_id) = screenshot_page_id else {
        return;
    };
    let page = PageId(page_id);
    if READ_ONLY_TOOLS.contains(&call.tool().name)
        && identity.session.has_first_capture(&page).await
    {
        return;
    }
    let Some(frame) = call.state.screencast.frame_for(page_id).await else {
        return;
    };
    match base64::engine::general_purpose::STANDARD.decode(frame.jpeg_base64.as_bytes()) {
        Ok(bytes) if !bytes.is_empty() => {
            if write_screenshot_files(call, record, &bytes).await {
                identity.session.mark_first_capture_done(page).await;
            }
        }
        Ok(_) => {}
        Err(error) => warn!(
            error = %error,
            dispatch_id = %call.dispatch_id,
            "fallback screenshot decode failed"
        ),
    }
}

async fn write_screenshot_files(call: &ToolCall, record: AuditRecord, bytes: &[u8]) -> bool {
    let row_key = record.row_id.to_string();
    if let Err(error) = call.state.screenshots.write(&row_key, bytes).await {
        warn!(
            error = %error,
            dispatch_id = %call.dispatch_id,
            "screenshot row-id write failed"
        );
        return false;
    }
    if let Err(error) = call
        .state
        .screenshots
        .write(call.dispatch_id.as_str(), bytes)
        .await
    {
        warn!(
            error = %error,
            dispatch_id = %call.dispatch_id,
            "screenshot dispatch-id write failed"
        );
    }
    if let Err(error) = call.state.audit.mark_screenshot(record.row_id).await {
        warn!(
            error = %error,
            dispatch_id = %call.dispatch_id,
            "audit screenshot marker failed"
        );
    }
    true
}

fn image_data(block: &ContentBlock) -> Option<&str> {
    match block {
        ContentBlock::Image(image) => Some(image.data.as_str()),
        _ => None,
    }
}

const _: ToolEffect = apply;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::audit::ListDispatchesQuery;
    use serde_json::json;

    #[tokio::test]
    async fn explicit_image_persists_when_fallback_is_disabled() -> anyhow::Result<()> {
        let call = crate::mcp::test_support::tool_call_with_fallback(
            "navigate",
            json!({ "page": 1 }),
            false,
        )
        .await?;
        let identity = call.identity.as_ref().unwrap_or_else(|| unreachable!());
        let result = ToolResult::image("anBlZw==", "image/jpeg", json!({}));
        persist_screenshot(&call, &result, AuditRecord { row_id: 7 }, identity).await;
        assert_eq!(
            call.state.screenshots.read("7").await.unwrap_or_default(),
            b"jpeg"
        );
        assert_eq!(
            call.state
                .screenshots
                .read(call.dispatch_id.as_str())
                .await
                .unwrap_or_default(),
            b"jpeg"
        );
        assert!(identity.session.has_first_capture(&PageId(1)).await);
        Ok(())
    }

    #[tokio::test]
    async fn records_cancellations_but_skips_other_errors() -> anyhow::Result<()> {
        let call = crate::mcp::test_support::tool_call("tabs", json!({ "action": "list" })).await?;
        let failed = ToolResult::error("failed");
        apply(ToolEffectContext {
            call: &call,
            result: &failed,
            cancelled: false,
            duration_ms: 4,
        })
        .await?;
        assert!(
            call.state
                .audit
                .list_dispatches(ListDispatchesQuery::default())
                .await?
                .rows
                .is_empty()
        );

        let cancelled = ToolResult {
            content: vec![ContentBlock::text("Operation cancelled by the User")],
            is_error: true,
            structured_content: Some(json!({
                "cancellationReason": "Operation cancelled by the User",
                "cancellationKind": "cockpit.operator-cancelled"
            })),
        };
        apply(ToolEffectContext {
            call: &call,
            result: &cancelled,
            cancelled: true,
            duration_ms: 5,
        })
        .await?;
        let rows = call
            .state
            .audit
            .list_dispatches(ListDispatchesQuery::default())
            .await?
            .rows;
        assert_eq!(rows.len(), 1);
        assert!(
            rows[0]
                .result_meta
                .as_deref()
                .is_some_and(|meta| meta.contains("cancellationKind"))
        );
        Ok(())
    }

    #[tokio::test]
    async fn success_without_identity_writes_no_row() -> anyhow::Result<()> {
        let mut call =
            crate::mcp::test_support::tool_call("tabs", json!({ "action": "list" })).await?;
        call.identity = None;
        let result = ToolResult::text("ok", Some(json!({ "pages": [] })));
        apply(ToolEffectContext {
            call: &call,
            result: &result,
            cancelled: false,
            duration_ms: 1,
        })
        .await?;
        assert!(
            call.state
                .audit
                .list_dispatches(ListDispatchesQuery::default())
                .await?
                .rows
                .is_empty()
        );
        Ok(())
    }
}
