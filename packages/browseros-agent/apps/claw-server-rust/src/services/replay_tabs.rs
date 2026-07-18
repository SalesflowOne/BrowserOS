use crate::{
    domain::{SessionRegistry, TabGroupColor},
    services::tab_activity::TabActivityService,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayTab {
    pub session_id: String,
    pub tab_page_id: u32,
    pub url: String,
    pub title: String,
    pub group_color: Option<TabGroupColor>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayTabsResponse {
    pub tabs: Vec<ReplayTab>,
}

/// Builds legacy replay discovery rows from exact live-session tab associations.
pub async fn list_replay_tabs(
    sessions: &SessionRegistry,
    tab_activity: &TabActivityService,
) -> ReplayTabsResponse {
    let records = tab_activity.snapshot().await;
    let mut tabs = Vec::new();
    for record in records {
        let Some(session) = sessions
            .lookup(&crate::domain::SessionId::new(record.session_id))
            .await
        else {
            continue;
        };
        let agent_key = session.ownership_key().clone();
        tabs.push(ReplayTab {
            session_id: session.id().as_str().to_string(),
            tab_page_id: record.page_id,
            url: record.url,
            title: record.title,
            group_color: sessions.ownership().tab_group_color(&agent_key).await,
        });
    }

    ReplayTabsResponse { tabs }
}
