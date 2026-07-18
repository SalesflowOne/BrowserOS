use crate::domain::TabGroupColor;
use browseros_core::PageId;
use std::{
    collections::{BTreeSet, HashMap},
    fmt,
};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct AgentKey(String);

impl AgentKey {
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for AgentKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Default)]
pub struct AgentPageOwnership {
    inner: RwLock<OwnershipInner>,
}

#[derive(Debug, Default)]
struct OwnershipInner {
    page_owners: HashMap<PageId, AgentKey>,
    agents: HashMap<AgentKey, AgentOwnershipState>,
}

#[derive(Debug, Default)]
struct AgentOwnershipState {
    pages: BTreeSet<PageId>,
    tab_group_ref: Option<String>,
    tab_group_color: Option<TabGroupColor>,
    tab_group_collapsed: bool,
    desired_group_title: Option<String>,
    group_title_sync_pending: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct AgentTabGroupState {
    pub group_ref: Option<String>,
    pub color: Option<TabGroupColor>,
    pub collapsed: bool,
    pub desired_title: Option<String>,
    pub title_sync_pending: bool,
}

impl AgentPageOwnership {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn owner_of_page(&self, page_id: &PageId) -> Option<AgentKey> {
        self.inner.read().await.page_owners.get(page_id).cloned()
    }

    pub async fn claim_page(&self, agent_key: AgentKey, page_id: PageId) {
        let mut inner = self.inner.write().await;
        if let Some(previous) = inner.page_owners.insert(page_id.clone(), agent_key.clone())
            && previous != agent_key
            && let Some(previous_agent) = inner.agents.get_mut(&previous)
        {
            previous_agent.pages.remove(&page_id);
        }
        inner
            .agents
            .entry(agent_key)
            .or_default()
            .pages
            .insert(page_id);
        inner.remove_empty_agents();
    }

    pub async fn remove_page(&self, page_id: &PageId) -> Option<AgentKey> {
        let mut inner = self.inner.write().await;
        let owner = inner.page_owners.remove(page_id)?;
        if let Some(agent) = inner.agents.get_mut(&owner) {
            agent.pages.remove(page_id);
        }
        inner.remove_empty_agents();
        Some(owner)
    }

    pub async fn prune_missing_pages(&self, live_pages: &BTreeSet<PageId>) -> Vec<PageId> {
        let mut inner = self.inner.write().await;
        let stale = inner
            .page_owners
            .keys()
            .filter(|page_id| !live_pages.contains(*page_id))
            .cloned()
            .collect::<Vec<_>>();
        for page_id in &stale {
            if let Some(owner) = inner.page_owners.remove(page_id)
                && let Some(agent) = inner.agents.get_mut(&owner)
            {
                agent.pages.remove(page_id);
            }
        }
        inner.remove_empty_agents();
        stale
    }

    pub async fn owned_pages(&self, agent_key: &AgentKey) -> BTreeSet<PageId> {
        self.inner
            .read()
            .await
            .agents
            .get(agent_key)
            .map(|agent| agent.pages.clone())
            .unwrap_or_default()
    }

    pub async fn tab_group_ref(&self, agent_key: &AgentKey) -> Option<String> {
        self.inner
            .read()
            .await
            .agents
            .get(agent_key)
            .and_then(|agent| agent.tab_group_ref.clone())
    }

    pub async fn set_tab_group_ref(&self, agent_key: AgentKey, value: Option<String>) {
        let mut inner = self.inner.write().await;
        let agent = inner.agents.entry(agent_key).or_default();
        agent.tab_group_ref = value;
        if agent.tab_group_ref.is_none() {
            agent.tab_group_collapsed = false;
            agent.group_title_sync_pending = false;
        }
        inner.remove_empty_agents();
    }

    pub async fn tab_group_color(&self, agent_key: &AgentKey) -> Option<TabGroupColor> {
        self.inner
            .read()
            .await
            .agents
            .get(agent_key)
            .and_then(|agent| agent.tab_group_color)
    }

    pub async fn set_tab_group_color(&self, agent_key: AgentKey, value: Option<TabGroupColor>) {
        let mut inner = self.inner.write().await;
        inner.agents.entry(agent_key).or_default().tab_group_color = value;
        inner.remove_empty_agents();
    }

    pub async fn tab_group_collapsed(&self, agent_key: &AgentKey) -> bool {
        self.inner
            .read()
            .await
            .agents
            .get(agent_key)
            .is_some_and(|agent| agent.tab_group_collapsed)
    }

    pub async fn set_tab_group_collapsed(&self, agent_key: AgentKey, collapsed: bool) {
        let mut inner = self.inner.write().await;
        let agent = inner.agents.entry(agent_key).or_default();
        agent.tab_group_collapsed = collapsed && agent.tab_group_ref.is_some();
        inner.remove_empty_agents();
    }

    pub async fn set_tab_group_collapsed_if_current(
        &self,
        agent_key: &AgentKey,
        group_ref: &str,
        collapsed: bool,
    ) {
        let mut inner = self.inner.write().await;
        let Some(agent) = inner.agents.get_mut(agent_key) else {
            return;
        };
        if agent.tab_group_ref.as_deref() == Some(group_ref) {
            agent.tab_group_collapsed = collapsed;
        }
    }

    pub async fn set_tab_group(
        &self,
        agent_key: AgentKey,
        group_ref: Option<String>,
        color: Option<TabGroupColor>,
    ) {
        let mut inner = self.inner.write().await;
        let agent = inner.agents.entry(agent_key).or_default();
        agent.tab_group_ref = group_ref;
        agent.tab_group_color = color;
        agent.tab_group_collapsed = false;
        if agent.tab_group_ref.is_none() {
            agent.group_title_sync_pending = false;
        }
        inner.remove_empty_agents();
    }

    /// Installs a newly created group with the title already applied by Chromium.
    pub async fn set_tab_group_with_title(
        &self,
        agent_key: AgentKey,
        group_ref: String,
        color: TabGroupColor,
        title: String,
    ) {
        let mut inner = self.inner.write().await;
        let agent = inner.agents.entry(agent_key).or_default();
        agent.tab_group_ref = Some(group_ref);
        agent.tab_group_color = Some(color);
        agent.tab_group_collapsed = false;
        agent.desired_group_title = Some(title);
        agent.group_title_sync_pending = false;
    }

    pub async fn tab_group_state(&self, agent_key: &AgentKey) -> Option<AgentTabGroupState> {
        self.inner
            .read()
            .await
            .agents
            .get(agent_key)
            .map(|agent| AgentTabGroupState {
                group_ref: agent.tab_group_ref.clone(),
                color: agent.tab_group_color,
                collapsed: agent.tab_group_collapsed,
                desired_title: agent.desired_group_title.clone(),
                title_sync_pending: agent.group_title_sync_pending,
            })
    }

    /// Records the authoritative title before any best-effort browser update.
    pub async fn set_desired_group_title(&self, agent_key: AgentKey, title: String) {
        let mut inner = self.inner.write().await;
        let agent = inner.agents.entry(agent_key).or_default();
        agent.desired_group_title = Some(title);
        agent.group_title_sync_pending = agent.tab_group_ref.is_some();
    }

    pub async fn pending_group_title(&self, agent_key: &AgentKey) -> Option<(String, String)> {
        let inner = self.inner.read().await;
        let agent = inner.agents.get(agent_key)?;
        if !agent.group_title_sync_pending {
            return None;
        }
        Some((
            agent.tab_group_ref.clone()?,
            agent.desired_group_title.clone()?,
        ))
    }

    pub async fn mark_group_title_synced(
        &self,
        agent_key: &AgentKey,
        group_ref: &str,
        title: &str,
    ) {
        let mut inner = self.inner.write().await;
        let Some(agent) = inner.agents.get_mut(agent_key) else {
            return;
        };
        if agent.tab_group_ref.as_deref() == Some(group_ref)
            && agent.desired_group_title.as_deref() == Some(title)
        {
            agent.group_title_sync_pending = false;
        }
    }

    /// Removes all durable ownership and tab-group state for an agent key.
    pub async fn forget(&self, agent_key: &AgentKey) {
        let mut inner = self.inner.write().await;
        if let Some(agent) = inner.agents.remove(agent_key) {
            for page_id in agent.pages {
                if inner.page_owners.get(&page_id) == Some(agent_key) {
                    inner.page_owners.remove(&page_id);
                }
            }
        }
    }
}

impl OwnershipInner {
    fn remove_empty_agents(&mut self) {
        self.agents.retain(|_, agent| {
            !agent.pages.is_empty()
                || agent.tab_group_ref.is_some()
                || agent.tab_group_color.is_some()
                || agent.desired_group_title.is_some()
                || agent.group_title_sync_pending
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentKey, AgentPageOwnership};
    use crate::domain::TabGroupColor;
    use browseros_core::PageId;
    use std::collections::BTreeSet;

    #[tokio::test]
    async fn page_ownership_moves_between_agent_keys() {
        let ownership = AgentPageOwnership::new();
        let codex = AgentKey::new("codex");
        let cowork = AgentKey::new("cowork");

        ownership.claim_page(codex.clone(), PageId(1)).await;
        ownership.claim_page(cowork.clone(), PageId(1)).await;

        assert_eq!(ownership.owner_of_page(&PageId(1)).await, Some(cowork));
        assert!(ownership.owned_pages(&codex).await.is_empty());
    }

    #[tokio::test]
    async fn prune_missing_pages_removes_stale_page_owners() {
        let ownership = AgentPageOwnership::new();
        let codex = AgentKey::new("codex");
        ownership.claim_page(codex.clone(), PageId(1)).await;
        ownership.claim_page(codex.clone(), PageId(2)).await;

        let stale = ownership
            .prune_missing_pages(&BTreeSet::from([PageId(2)]))
            .await;

        assert_eq!(stale, vec![PageId(1)]);
        assert_eq!(
            ownership.owned_pages(&codex).await,
            BTreeSet::from([PageId(2)])
        );
    }

    #[tokio::test]
    async fn tab_group_state_survives_empty_page_set() {
        let ownership = AgentPageOwnership::new();
        let codex = AgentKey::new("codex");
        ownership.claim_page(codex.clone(), PageId(1)).await;
        ownership
            .set_tab_group(
                codex.clone(),
                Some("group-1".to_string()),
                Some(TabGroupColor::Purple),
            )
            .await;

        ownership.remove_page(&PageId(1)).await;

        assert_eq!(
            ownership.tab_group_ref(&codex).await.as_deref(),
            Some("group-1")
        );
        assert_eq!(
            ownership.tab_group_color(&codex).await,
            Some(TabGroupColor::Purple)
        );
        assert!(!ownership.tab_group_collapsed(&codex).await);
    }

    #[tokio::test]
    async fn forget_drops_pages_and_group_state() {
        let ownership = AgentPageOwnership::new();
        let codex = AgentKey::new("codex");
        ownership.claim_page(codex.clone(), PageId(1)).await;
        ownership
            .set_tab_group(
                codex.clone(),
                Some("group-1".to_string()),
                Some(TabGroupColor::Purple),
            )
            .await;

        ownership.forget(&codex).await;

        assert_eq!(ownership.owner_of_page(&PageId(1)).await, None);
        assert!(ownership.owned_pages(&codex).await.is_empty());
        assert_eq!(ownership.tab_group_ref(&codex).await, None);
    }

    #[tokio::test]
    async fn collapsed_state_requires_a_live_group_ref() {
        let ownership = AgentPageOwnership::new();
        let codex = AgentKey::new("codex");
        ownership
            .set_tab_group_ref(codex.clone(), Some("group-1".to_string()))
            .await;
        ownership.set_tab_group_collapsed(codex.clone(), true).await;
        assert!(ownership.tab_group_collapsed(&codex).await);

        ownership.set_tab_group_ref(codex.clone(), None).await;

        assert!(!ownership.tab_group_collapsed(&codex).await);
    }

    #[tokio::test]
    async fn desired_title_stays_pending_until_matching_group_sync() {
        let ownership = AgentPageOwnership::new();
        let codex = AgentKey::new("codex");
        ownership
            .set_desired_group_title(codex.clone(), "codex/first".to_string())
            .await;
        assert_eq!(ownership.pending_group_title(&codex).await, None);
        ownership
            .set_tab_group_with_title(
                codex.clone(),
                "group-1".to_string(),
                TabGroupColor::Purple,
                "codex/first".to_string(),
            )
            .await;
        ownership
            .set_desired_group_title(codex.clone(), "codex/second".to_string())
            .await;
        assert_eq!(
            ownership.pending_group_title(&codex).await,
            Some(("group-1".to_string(), "codex/second".to_string()))
        );

        ownership
            .mark_group_title_synced(&codex, "group-1", "codex/first")
            .await;
        assert!(
            ownership
                .tab_group_state(&codex)
                .await
                .is_some_and(|state| state.title_sync_pending)
        );
        ownership
            .mark_group_title_synced(&codex, "group-1", "codex/second")
            .await;
        assert!(
            ownership
                .tab_group_state(&codex)
                .await
                .is_some_and(|state| !state.title_sync_pending)
        );
    }
}
