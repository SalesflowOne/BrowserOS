use crate::{
    app::AppState,
    dispatch::pipeline::{DispatchCtx, DispatchTiming, extract_page_id, result_page_id},
    domain::color_for_slug,
    services::{
        audit::{DispatchResultSummary, RecordToolDispatchInput},
        tab_activity::RecordToolInput,
    },
};
use base64::Engine;
use browseros_core::{
    PageId,
    screenshot::{ScreenshotCaptureOptions, ScreenshotFormat},
};
use browseros_mcp::{
    BrowserToolDefaults, BrowserToolOptions, ToolCtx, catalog, execute_tool,
    framework::{OutputFileAccess, ToolResult},
};
use rmcp::model::ContentBlock;
use serde_json::{Value, json};
use tracing::warn;

pub struct ObserverRunner;

#[derive(Debug, Clone, Copy)]
pub struct AuditRecord {
    pub row_id: i64,
}

impl ObserverRunner {
    pub async fn run(
        state: &AppState,
        ctx: &DispatchCtx<'_>,
        result: &mut ToolResult,
        timing: DispatchTiming,
        output_files: OutputFileAccess,
    ) {
        TabsResultFilter::apply(ctx, result).await;
        let audit = AuditWriter::record(state, ctx, result, timing).await;
        if let Some(record) = audit {
            ScreenshotPersister::persist(state, ctx, result, record, output_files.clone()).await;
        }
        TabActivityTracker::record(state, ctx, result).await;
        TabGroupOrchestrator::record(state, ctx, result, output_files).await;
    }
}

pub struct AuditWriter;

impl AuditWriter {
    async fn record(
        state: &AppState,
        ctx: &DispatchCtx<'_>,
        result: &ToolResult,
        timing: DispatchTiming,
    ) -> Option<AuditRecord> {
        let page_id =
            result_page_id(result).or_else(|| extract_page_id(ctx.tool.name, ctx.raw_args));
        let live = match (&ctx.browser_session, page_id) {
            (Some(browser), Some(page_id)) => browser.pages.get_info(PageId(page_id)).await,
            _ => None,
        };
        let content = serde_json::to_value(&result.content).unwrap_or_else(|err| {
            warn!(error = %err, "tool content serialization failed");
            json!([])
        });
        let structured_content = result.structured_content.clone().unwrap_or(Value::Null);
        match state
            .audit
            .record_tool_dispatch(RecordToolDispatchInput {
                agent_id: ctx.session.agent().agent_id().as_str().to_string(),
                slug: ctx.session.agent().slug().to_string(),
                agent_label: ctx.session.agent().label().to_string(),
                session_id: ctx.session.id().as_str().to_string(),
                tool_name: ctx.tool.name.to_string(),
                page_id: page_id.map(i64::from),
                target_id: live
                    .as_ref()
                    .map(|page| page.target_id.as_str().to_string()),
                url: live.as_ref().map(|page| page.url.clone()),
                title: live.as_ref().map(|page| page.title.clone()),
                raw_args: ctx.raw_args.clone(),
                duration_ms: timing.duration_ms,
                dispatch_id: ctx.dispatch_id.clone(),
                result: DispatchResultSummary {
                    is_error: result.is_error,
                    structured_content,
                    content,
                },
            })
            .await
        {
            Ok(row_id) => Some(AuditRecord { row_id }),
            Err(err) => {
                warn!(error = %err, dispatch_id = %ctx.dispatch_id, "audit writer failed");
                None
            }
        }
    }
}

pub struct ScreenshotPersister;

impl ScreenshotPersister {
    async fn persist(
        state: &AppState,
        ctx: &DispatchCtx<'_>,
        result: &ToolResult,
        record: AuditRecord,
        output_files: OutputFileAccess,
    ) {
        if result.is_error {
            return;
        }
        let mut wrote = false;
        for image in result.content.iter().filter_map(image_data) {
            match base64::engine::general_purpose::STANDARD.decode(image.data.as_bytes()) {
                Ok(bytes) => {
                    if write_screenshot_files(state, ctx, record, &bytes).await {
                        wrote = true;
                        break;
                    }
                }
                Err(err) => {
                    warn!(error = %err, dispatch_id = %ctx.dispatch_id, "tool-result image decode failed")
                }
            }
        }
        if wrote {
            return;
        }
        let Some(browser) = &ctx.browser_session else {
            return;
        };
        let page_id =
            result_page_id(result).or_else(|| extract_page_id(ctx.tool.name, ctx.raw_args));
        let Some(page_id) = page_id else {
            return;
        };
        let page = PageId(page_id);
        let should_capture =
            ctx.hooks.capture_new_page || !ctx.session.has_first_capture(&page).await;
        if !should_capture {
            return;
        }
        let options = ScreenshotCaptureOptions {
            format: Some(ScreenshotFormat::Jpeg),
            quality: Some(50),
            full_page: Some(false),
            annotate: Some(false),
            clip: None,
        };
        match browser.screenshot(page.clone(), options).await {
            Ok(capture) => match base64::engine::general_purpose::STANDARD.decode(capture.data) {
                Ok(bytes) => {
                    if write_screenshot_files(state, ctx, record, &bytes).await {
                        ctx.session.mark_first_capture_done(page).await;
                    }
                }
                Err(err) => {
                    warn!(error = %err, dispatch_id = %ctx.dispatch_id, "fallback screenshot decode failed")
                }
            },
            Err(err) => {
                warn!(error = %err, dispatch_id = %ctx.dispatch_id, "fallback screenshot capture failed")
            }
        }
        drop(output_files);
    }
}

async fn write_screenshot_files(
    state: &AppState,
    ctx: &DispatchCtx<'_>,
    record: AuditRecord,
    bytes: &[u8],
) -> bool {
    let row_key = record.row_id.to_string();
    let ulid_key = ctx.dispatch_id.as_str();
    let write_row = state.screenshots.write(&row_key, bytes).await;
    let write_ulid = state.screenshots.write(ulid_key, bytes).await;
    if let Err(err) = write_row {
        warn!(error = %err, dispatch_id = %ctx.dispatch_id, "screenshot row-id write failed");
        return false;
    }
    if let Err(err) = write_ulid {
        warn!(error = %err, dispatch_id = %ctx.dispatch_id, "screenshot dispatch-id write failed");
    }
    if let Err(err) = state.audit.mark_screenshot(record.row_id).await {
        warn!(error = %err, dispatch_id = %ctx.dispatch_id, "audit screenshot marker failed");
    }
    true
}

struct ImageRef<'a> {
    data: &'a str,
}

fn image_data(block: &ContentBlock) -> Option<ImageRef<'_>> {
    match block {
        ContentBlock::Image(image) => Some(ImageRef { data: &image.data }),
        _ => None,
    }
}

pub struct TabActivityTracker;

impl TabActivityTracker {
    async fn record(state: &AppState, ctx: &DispatchCtx<'_>, result: &ToolResult) {
        if result.is_error {
            return;
        }
        let Some(browser) = &ctx.browser_session else {
            return;
        };
        let Some(page_id) =
            result_page_id(result).or_else(|| extract_page_id(ctx.tool.name, ctx.raw_args))
        else {
            return;
        };
        let Some(info) = browser.pages.get_info(PageId(page_id)).await else {
            return;
        };
        state
            .tab_activity
            .record_tool(RecordToolInput {
                target_id: info.target_id,
                page_id,
                url: info.url,
                title: info.title,
                agent_id: ctx.session.agent().agent_id().as_str().to_string(),
                slug: ctx.session.agent().slug().to_string(),
                tool_name: ctx.tool.name.to_string(),
            })
            .await;
    }
}

pub struct TabGroupOrchestrator;

impl TabGroupOrchestrator {
    async fn record(
        _state: &AppState,
        ctx: &DispatchCtx<'_>,
        result: &ToolResult,
        output_files: OutputFileAccess,
    ) {
        if result.is_error || !ctx.hooks.capture_new_page {
            return;
        }
        let Some(browser) = &ctx.browser_session else {
            return;
        };
        let Some(page_id) = result_page_id(result) else {
            return;
        };
        let Some(tab_groups) = catalog().into_iter().find(|tool| tool.name == "tab_groups") else {
            warn!("tab_groups tool missing from catalog");
            return;
        };
        let group_id = ctx.session.tab_group_ref().await;
        let created_new_group = group_id.is_none();
        let color = color_for_slug(ctx.session.agent().slug());
        let args = if let Some(group_id) = group_id {
            json!({ "action": "create", "groupId": group_id, "pages": [page_id] })
        } else {
            json!({
                "action": "create",
                "pages": [page_id],
                "title": ctx.session.agent().slug()
            })
        };
        let tool_ctx = ToolCtx::new(BrowserToolOptions {
            session: browser.clone(),
            defaults: BrowserToolDefaults::default(),
            cancel: ctx.cancel.clone(),
            output_files,
        });
        match execute_tool(&tab_groups, args, &tool_ctx).await {
            Ok(group_result) if !group_result.is_error => {
                if let Some(group_id) = group_result
                    .structured_content
                    .as_ref()
                    .and_then(|value| value.get("group"))
                    .and_then(|value| value.get("groupId"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                {
                    ctx.session.set_tab_group_ref(Some(group_id.clone())).await;
                    ctx.session.set_tab_group_color(Some(color)).await;
                    if created_new_group {
                        match execute_tool(
                            &tab_groups,
                            json!({ "action": "update", "groupId": group_id, "color": color }),
                            &tool_ctx,
                        )
                        .await
                        {
                            Ok(result) if !result.is_error => {}
                            Ok(result) => warn!(
                                dispatch_id = %ctx.dispatch_id,
                                group_color = %color,
                                error = first_text(&result),
                                "tab group color lock returned error"
                            ),
                            Err(err) => warn!(
                                error = %err,
                                dispatch_id = %ctx.dispatch_id,
                                group_color = %color,
                                "tab group color lock failed"
                            ),
                        }
                    }
                }
            }
            Ok(group_result) => warn!(
                dispatch_id = %ctx.dispatch_id,
                error = first_text(&group_result),
                "tab group orchestration returned error"
            ),
            Err(err) => {
                warn!(error = %err, dispatch_id = %ctx.dispatch_id, "tab group orchestration failed")
            }
        }
    }
}

pub struct TabsResultFilter;

impl TabsResultFilter {
    async fn apply(ctx: &DispatchCtx<'_>, result: &mut ToolResult) {
        if result.is_error || !ctx.hooks.filter_tabs_list {
            return;
        }
        let owned = ctx.session.owned_pages().await;
        let Some(Value::Object(structured)) = result.structured_content.as_ref() else {
            return;
        };
        let Some(pages) = structured.get("pages").and_then(Value::as_array) else {
            return;
        };
        let surviving = pages
            .iter()
            .filter(|page| {
                page.get("page")
                    .and_then(Value::as_u64)
                    .and_then(|value| u32::try_from(value).ok())
                    .map(|page_id| owned.contains(&PageId(page_id)))
                    .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        let lines = surviving
            .iter()
            .filter_map(format_tab_line)
            .collect::<Vec<_>>();
        result.content = vec![ContentBlock::text(if lines.is_empty() {
            "(no open pages)".to_string()
        } else {
            lines.join("\n")
        })];
        result.structured_content = Some(json!({ "pages": surviving }));
        result.is_error = false;
    }
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

fn first_text(result: &ToolResult) -> String {
    result
        .content
        .iter()
        .find_map(|block| match block {
            ContentBlock::Text(text) => Some(text.text.clone()),
            _ => None,
        })
        .unwrap_or_else(|| "unknown error".to_string())
}

pub async fn apply_post_execution_hooks(ctx: &DispatchCtx<'_>, result: &ToolResult) {
    if result.is_error {
        return;
    }
    if ctx.hooks.capture_new_page
        && let Some(page_id) = result_page_id(result)
    {
        ctx.session.add_owned_page(PageId(page_id)).await;
    }
    if ctx.hooks.close_page
        && let Some(page_id) = extract_page_id(ctx.tool.name, ctx.raw_args)
    {
        ctx.session.remove_owned_page(&PageId(page_id)).await;
    }
}
