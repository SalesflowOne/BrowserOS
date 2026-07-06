use crate::domain::{AgentRef, DispatchId, SessionId};
use browseros_core::PageId;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::Duration,
};
use tokio::{
    sync::{Mutex, RwLock},
    time::Instant,
};
use tokio_util::sync::CancellationToken;

pub struct Session {
    id: SessionId,
    agent: AgentRef,
    owned_pages: RwLock<BTreeSet<PageId>>,
    first_captures: RwLock<BTreeSet<PageId>>,
    active_dispatches: Mutex<BTreeMap<DispatchId, CancellationToken>>,
    cancel: CancellationToken,
    tab_group_ref: Mutex<Option<String>>,
    replay_handle: Mutex<Option<String>>,
    last_activity: Mutex<Instant>,
}

impl Session {
    #[must_use]
    pub fn new(id: SessionId, agent: AgentRef, now: Instant) -> Arc<Self> {
        Arc::new(Self {
            id,
            agent,
            owned_pages: RwLock::new(BTreeSet::new()),
            first_captures: RwLock::new(BTreeSet::new()),
            active_dispatches: Mutex::new(BTreeMap::new()),
            cancel: CancellationToken::new(),
            tab_group_ref: Mutex::new(None),
            replay_handle: Mutex::new(None),
            last_activity: Mutex::new(now),
        })
    }

    #[must_use]
    pub fn id(&self) -> &SessionId {
        &self.id
    }

    #[must_use]
    pub fn agent(&self) -> &AgentRef {
        &self.agent
    }

    pub async fn touch(&self, now: Instant) {
        *self.last_activity.lock().await = now;
    }

    pub async fn idle_for(&self, now: Instant) -> Duration {
        now.saturating_duration_since(*self.last_activity.lock().await)
    }

    pub async fn add_owned_page(&self, page_id: PageId) {
        self.owned_pages.write().await.insert(page_id);
    }

    pub async fn remove_owned_page(&self, page_id: &PageId) {
        self.owned_pages.write().await.remove(page_id);
        self.first_captures.write().await.remove(page_id);
    }

    pub async fn owns_page(&self, page_id: &PageId) -> bool {
        self.owned_pages.read().await.contains(page_id)
    }

    pub async fn owned_pages(&self) -> Vec<PageId> {
        self.owned_pages.read().await.iter().cloned().collect()
    }

    pub async fn has_first_capture(&self, page_id: &PageId) -> bool {
        self.first_captures.read().await.contains(page_id)
    }

    pub async fn mark_first_capture_done(&self, page_id: PageId) {
        self.first_captures.write().await.insert(page_id);
    }

    pub async fn set_tab_group_ref(&self, value: Option<String>) {
        *self.tab_group_ref.lock().await = value;
    }

    pub async fn tab_group_ref(&self) -> Option<String> {
        self.tab_group_ref.lock().await.clone()
    }

    pub async fn set_replay_handle(&self, value: Option<String>) {
        *self.replay_handle.lock().await = value;
    }

    pub fn cancel(&self) {
        self.cancel.cancel();
    }

    pub async fn register_dispatch(&self, dispatch_id: DispatchId, token: CancellationToken) {
        self.active_dispatches
            .lock()
            .await
            .insert(dispatch_id, token);
    }

    pub async fn unregister_dispatch(&self, dispatch_id: &DispatchId) {
        self.active_dispatches.lock().await.remove(dispatch_id);
    }

    pub async fn cancel_active_dispatches(&self) -> usize {
        let tokens = self
            .active_dispatches
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for token in &tokens {
            token.cancel();
        }
        tokens.len()
    }

    #[must_use]
    pub fn child_token(&self) -> CancellationToken {
        self.cancel.child_token()
    }
}
