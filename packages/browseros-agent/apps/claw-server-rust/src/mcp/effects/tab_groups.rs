use crate::{
    domain::{AgentKey, AgentPageOwnership, color_for_slug},
    mcp::{
        dispatch::{ToolCall, ToolEffect, ToolEffectContext, result_page_id},
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
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock, Weak},
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::warn;

type GroupCreateLock = Mutex<()>;

static INFLIGHT_CREATES: OnceLock<Mutex<HashMap<AgentKey, Weak<GroupCreateLock>>>> =
    OnceLock::new();

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
        ensure_agent_tab_group(context.call, browser, &ownership, page_id).await;
        Ok(None)
    })
}

/// Serializes durable group creation and joins concurrent pages to the winning group.
async fn ensure_agent_tab_group(
    call: &ToolCall,
    browser: &Arc<BrowserSession>,
    ownership: &Arc<AgentPageOwnership>,
    page_id: u32,
) {
    let Some(identity) = call.identity.as_ref() else {
        return;
    };
    let create_lock = group_create_lock(&identity.ownership_key).await;
    let _guard = create_lock.lock().await;
    if let Some(group_id) = ownership.tab_group_ref(&identity.ownership_key).await {
        if let Err(reason) = dispatch_tab_groups(
            browser,
            call.cancel.clone(),
            call.output_files.clone(),
            json!({ "action": "create", "groupId": group_id, "pages": [page_id] }),
        )
        .await
        {
            ownership
                .set_tab_group(identity.ownership_key.clone(), None, None)
                .await;
            warn!(
                dispatch_id = %call.dispatch_id,
                error = %reason,
                "tab group add failed"
            );
        }
        return;
    }

    let color = ownership
        .tab_group_color(&identity.ownership_key)
        .await
        .unwrap_or_else(|| color_for_slug(identity.agent.slug()));
    let creation_title = desired_group_title(&identity.session).await;
    let group_result = match dispatch_tab_groups(
        browser,
        call.cancel.clone(),
        call.output_files.clone(),
        json!({ "action": "create", "pages": [page_id], "title": creation_title }),
    )
    .await
    {
        Ok(result) => result,
        Err(reason) => {
            warn!(
                dispatch_id = %call.dispatch_id,
                error = %reason,
                "tab group create failed"
            );
            return;
        }
    };
    let Some(group_id) = result_group_id(&group_result) else {
        warn!(
            dispatch_id = %call.dispatch_id,
            "tab group create returned no group id"
        );
        return;
    };
    ownership
        .set_tab_group(
            identity.ownership_key.clone(),
            Some(group_id.clone()),
            Some(color),
        )
        .await;
    if let Err(reason) = dispatch_tab_groups(
        browser,
        call.cancel.clone(),
        call.output_files.clone(),
        json!({ "action": "update", "groupId": group_id, "color": color }),
    )
    .await
    {
        warn!(
            dispatch_id = %call.dispatch_id,
            group_color = %color,
            error = %reason,
            "tab group color lock failed"
        );
    }
    let desired_title = desired_group_title(&identity.session).await;
    if desired_title != creation_title
        && let Err(reason) = dispatch_tab_groups(
            browser,
            call.cancel.clone(),
            call.output_files.clone(),
            json!({ "action": "update", "groupId": group_id, "title": desired_title }),
        )
        .await
    {
        warn!(
            dispatch_id = %call.dispatch_id,
            error = %reason,
            "tab group late title apply failed"
        );
    }
}

async fn group_create_lock(key: &AgentKey) -> Arc<GroupCreateLock> {
    let locks = INFLIGHT_CREATES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().await;
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(key.clone(), Arc::downgrade(&lock));
    lock
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
    use browseros_cdp::{CdpError, CdpEvent};
    use browseros_core::{BrowserSessionHooks, CdpConnection, SessionId};
    use std::{
        collections::{BTreeSet, HashMap},
        sync::{Arc, Mutex as StdMutex},
        time::Duration,
    };
    use tokio::sync::broadcast;

    struct GroupDispatchRecorder {
        sender: broadcast::Sender<CdpEvent>,
        calls: StdMutex<Vec<(String, Value)>>,
        members: StdMutex<HashMap<String, BTreeSet<i64>>>,
    }

    impl GroupDispatchRecorder {
        fn new() -> Self {
            let (sender, _) = broadcast::channel(8);
            Self {
                sender,
                calls: StdMutex::new(Vec::new()),
                members: StdMutex::new(HashMap::new()),
            }
        }

        fn record(&self, method: &str, params: &Value) {
            self.calls
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push((method.to_string(), params.clone()));
        }

        fn group_result(&self, group_id: &str, params: &Value) -> Value {
            let tab_ids = self
                .members
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get(group_id)
                .cloned()
                .unwrap_or_default();
            json!({
                "group": {
                    "groupId": group_id,
                    "windowId": 1,
                    "title": params.get("title").and_then(Value::as_str).unwrap_or("codex"),
                    "color": params.get("color").and_then(Value::as_str).unwrap_or("blue"),
                    "collapsed": params.get("collapsed").and_then(Value::as_bool).unwrap_or(false),
                    "tabIds": tab_ids
                }
            })
        }

        fn create_count(&self) -> usize {
            self.calls
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .iter()
                .filter(|(method, _)| method == "Browser.createTabGroup")
                .count()
        }

        fn group_members(&self, group_id: &str) -> BTreeSet<i64> {
            self.members
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get(group_id)
                .cloned()
                .unwrap_or_default()
        }
    }

    impl CdpConnection for GroupDispatchRecorder {
        fn send<'a>(
            &'a self,
            method: &'a str,
            params: Value,
            _session: Option<&'a SessionId>,
        ) -> BoxFuture<'a, Result<Value, CdpError>> {
            Box::pin(async move {
                self.record(method, &params);
                match method {
                    "Browser.getTabs" => Ok(json!({
                        "tabs": [test_tab(101, "target-1"), test_tab(102, "target-2")]
                    })),
                    "Browser.createTabGroup" => {
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        let tab_ids = params
                            .get("tabIds")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_i64)
                            .collect::<BTreeSet<_>>();
                        self.members
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .insert("group-1".to_string(), tab_ids);
                        Ok(self.group_result("group-1", &params))
                    }
                    "Browser.addTabsToGroup" => {
                        let group_id = params
                            .get("groupId")
                            .and_then(Value::as_str)
                            .unwrap_or("group-1");
                        let mut members = self
                            .members
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        members.entry(group_id.to_string()).or_default().extend(
                            params
                                .get("tabIds")
                                .and_then(Value::as_array)
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_i64),
                        );
                        drop(members);
                        Ok(self.group_result(group_id, &params))
                    }
                    "Browser.updateTabGroup" => {
                        let group_id = params
                            .get("groupId")
                            .and_then(Value::as_str)
                            .unwrap_or("group-1");
                        Ok(self.group_result(group_id, &params))
                    }
                    _ => Err(CdpError::Protocol {
                        code: -1,
                        message: format!("unexpected CDP call: {method}"),
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
                    message: format!("unexpected raw CDP call: {method}"),
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

    fn test_tab(tab_id: i64, target_id: &str) -> Value {
        json!({
            "tabId": tab_id,
            "targetId": target_id,
            "url": format!("https://example.com/{target_id}"),
            "title": target_id,
            "isActive": true,
            "isLoading": false,
            "loadProgress": 1.0,
            "isPinned": false,
            "isHidden": false,
            "windowId": 1,
            "index": tab_id - 101
        })
    }

    #[test]
    fn first_text_returns_empty_when_result_has_no_text() {
        let result = ToolResult::image("aGVsbG8=", "image/jpeg", json!({}));
        assert!(first_text(&result).is_empty());
    }

    #[tokio::test]
    async fn concurrent_first_pages_share_one_created_group() -> anyhow::Result<()> {
        let recorder = Arc::new(GroupDispatchRecorder::new());
        let browser = BrowserSession::new(recorder.clone(), BrowserSessionHooks::default());
        assert_eq!(browser.pages.list().await?.len(), 2);
        let mut first_call =
            crate::mcp::test_support::tool_call("tabs", json!({ "action": "new" })).await?;
        first_call.browser_session = Some(browser);
        let second_call = first_call.clone();
        let first_result = ToolResult::text("opened", Some(json!({ "page": 1 })));
        let second_result = ToolResult::text("opened", Some(json!({ "page": 2 })));

        let (first, second) = tokio::join!(
            apply(ToolEffectContext {
                call: &first_call,
                result: &first_result,
                cancelled: false,
                duration_ms: 1,
            }),
            apply(ToolEffectContext {
                call: &second_call,
                result: &second_result,
                cancelled: false,
                duration_ms: 1,
            })
        );
        first?;
        second?;

        assert_eq!(recorder.create_count(), 1);
        assert_eq!(
            recorder.group_members("group-1"),
            BTreeSet::from([101, 102])
        );
        let key = first_call
            .identity
            .as_ref()
            .unwrap_or_else(|| unreachable!())
            .ownership_key
            .clone();
        assert_eq!(
            first_call
                .state
                .sessions
                .ownership()
                .tab_group_ref(&key)
                .await
                .as_deref(),
            Some("group-1")
        );
        Ok(())
    }
}
