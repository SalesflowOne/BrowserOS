use crate::error::{AppError, AppResult};
use agent_mcp_manager::{
    AgentId, AgentScope, DisconnectInput, Error as ManagerError, LinkInput, ListLinksFilter,
    Manager, McpServer, McpServerSpec, is_installed, resolve_agent_mcp_config_path,
    resolve_agent_surface,
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fmt,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};
use tokio::sync::Mutex;

pub const BROWSEROS_MCP_SERVER_NAME: &str = "BrowserClaw";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Harness {
    #[serde(rename = "Claude Code")]
    ClaudeCode,
    #[serde(rename = "Codex")]
    Codex,
    #[serde(rename = "Cursor")]
    Cursor,
    #[serde(rename = "OpenCode")]
    OpenCode,
    #[serde(rename = "Antigravity")]
    Antigravity,
    #[serde(rename = "VS Code")]
    VsCode,
    #[serde(rename = "Zed")]
    Zed,
}

impl Harness {
    pub const ALL: [Self; 7] = [
        Self::ClaudeCode,
        Self::Codex,
        Self::Cursor,
        Self::OpenCode,
        Self::Antigravity,
        Self::VsCode,
        Self::Zed,
    ];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor",
            Self::OpenCode => "OpenCode",
            Self::Antigravity => "Antigravity",
            Self::VsCode => "VS Code",
            Self::Zed => "Zed",
        }
    }

    #[must_use]
    pub const fn agent_id(self) -> AgentId {
        match self {
            Self::ClaudeCode => AgentId::ClaudeCode,
            Self::Codex => AgentId::Codex,
            Self::Cursor => AgentId::Cursor,
            Self::OpenCode => AgentId::OpenCode,
            Self::Antigravity => AgentId::Antigravity,
            Self::VsCode => AgentId::VsCode,
            Self::Zed => AgentId::Zed,
        }
    }
}

impl fmt::Display for Harness {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for Harness {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.replace("%20", " ").as_str() {
            "Claude Code" => Ok(Self::ClaudeCode),
            "Codex" => Ok(Self::Codex),
            "Cursor" => Ok(Self::Cursor),
            "OpenCode" => Ok(Self::OpenCode),
            "Antigravity" => Ok(Self::Antigravity),
            "VS Code" => Ok(Self::VsCode),
            "Zed" => Ok(Self::Zed),
            _ => Err(AppError::bad_request("unsupported harness")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub harness: Harness,
    pub installed: bool,
    pub agent_id: AgentId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IntegrityScanOutcome {
    pub verified: usize,
    pub drifted: usize,
    pub missing: usize,
    pub healed: usize,
    pub failed: usize,
}

#[derive(Clone)]
pub struct HarnessService {
    manager: Manager,
    home_dir: PathBuf,
    mutex: Arc<Mutex<()>>,
}

impl HarnessService {
    #[must_use]
    pub fn new(workspace_dir: PathBuf, home_dir: PathBuf) -> Self {
        Self {
            manager: Manager::new(workspace_dir),
            home_dir,
            mutex: Arc::new(Mutex::new(())),
        }
    }

    /// Registers BrowserClaw in one harness while restoring the previous spec on relink failure.
    pub async fn connect_browseros(
        &self,
        harness: Harness,
        mcp_url: &str,
    ) -> AppResult<ConnectionState> {
        let _guard = self.mutex.lock().await;
        let agent = harness.agent_id();
        let spec = spec_for(agent, mcp_url).map_err(manager_app_error)?;
        let manager = self.manager.clone();
        let result = tokio::task::spawn_blocking(move || {
            relink_managed_server(&manager, BROWSEROS_MCP_SERVER_NAME, agent, spec, true)?;
            Ok(resolve_agent_mcp_config_path(agent, AgentScope::System).ok())
        })
        .await?;

        match result {
            Ok(config_path) => {
                tracing::info!(harness = %harness, agent = %agent, "connected BrowserClaw to harness");
                Ok(ConnectionState {
                    harness,
                    installed: true,
                    agent_id: agent,
                    config_path: tildify_home_path(config_path.as_deref(), &self.home_dir),
                    message: format!("BrowserOS registered as an MCP server in {harness}."),
                })
            }
            Err(error) => Ok(self.failure(harness, error, "connect")),
        }
    }

    /// Removes BrowserClaw from one harness and drops its last-link manifest entry.
    pub async fn disconnect_browseros(&self, harness: Harness) -> AppResult<ConnectionState> {
        let _guard = self.mutex.lock().await;
        let agent = harness.agent_id();
        let manager = self.manager.clone();
        let result = tokio::task::spawn_blocking(move || {
            manager
                .disconnect(DisconnectInput::new(BROWSEROS_MCP_SERVER_NAME, agent))
                .map_err(HarnessOperationError::Manager)
        })
        .await?;

        match result {
            Ok(summary) => {
                tracing::info!(
                    harness = %harness,
                    agent = %agent,
                    unlinked = summary.unlinked,
                    removed_manifest = summary.removed_manifest,
                    "disconnected BrowserClaw from harness"
                );
                Ok(ConnectionState {
                    harness,
                    installed: false,
                    agent_id: agent,
                    config_path: None,
                    message: format!("BrowserOS unregistered from {harness}."),
                })
            }
            Err(error) => Ok(self.failure(harness, error, "disconnect")),
        }
    }

    /// Lists installed harnesses, using manifest links as the configured source of truth.
    pub async fn list_browseros_connections(&self) -> AppResult<Vec<ConnectionState>> {
        let _guard = self.mutex.lock().await;
        let manager = self.manager.clone();
        let agents = Harness::ALL.map(Harness::agent_id);
        let (links_result, installed_result) = tokio::task::spawn_blocking(move || {
            let links = manager.list_links(ListLinksFilter {
                server_names: Some(vec![BROWSEROS_MCP_SERVER_NAME.to_string()]),
                agents: None,
            });
            (links, is_installed(&agents))
        })
        .await?;

        let links = match links_result {
            Ok(links) => links,
            Err(error) => {
                tracing::warn!(error = %error, "list BrowserClaw links failed");
                Vec::new()
            }
        };
        let installed = match installed_result {
            Ok(installed) => installed,
            Err(error) => {
                tracing::warn!(error = %error, "probe installed harnesses failed");
                agents.into_iter().map(|agent| (agent, true)).collect()
            }
        };
        let by_agent = links
            .into_iter()
            .map(|link| (link.agent, link))
            .collect::<BTreeMap<_, _>>();

        Ok(Harness::ALL
            .into_iter()
            .filter_map(|harness| {
                let agent = harness.agent_id();
                let link = by_agent.get(&agent);
                if link.is_none() && !installed.get(&agent).copied().unwrap_or(false) {
                    return None;
                }
                Some(match link {
                    Some(link) => ConnectionState {
                        harness,
                        installed: true,
                        agent_id: agent,
                        config_path: tildify_home_path(
                            Some(link.config_path.as_path()),
                            &self.home_dir,
                        ),
                        message: format!("Configured in {harness}."),
                    },
                    None => ConnectionState {
                        harness,
                        installed: false,
                        agent_id: agent,
                        config_path: None,
                        message: format!("{harness} is not configured."),
                    },
                })
            })
            .collect())
    }

    /// Rescans managed entries and repairs drifted or missing files from manifest specs.
    pub async fn run_integrity_scan(&self) -> AppResult<IntegrityScanOutcome> {
        let _guard = self.mutex.lock().await;
        let manager = self.manager.clone();
        tokio::task::spawn_blocking(move || run_integrity_scan(&manager))
            .await?
            .map_err(manager_app_error)
    }

    fn failure(
        &self,
        harness: Harness,
        error: HarnessOperationError,
        operation: &'static str,
    ) -> ConnectionState {
        let agent_id = harness.agent_id();
        match error {
            HarnessOperationError::Manager(ManagerError::AgentNotInstalled { .. }) => {
                tracing::info!(harness = %harness, agent = %agent_id, "harness is not installed");
                ConnectionState {
                    harness,
                    installed: false,
                    agent_id,
                    config_path: None,
                    message: format!(
                        "{harness} is not installed on this machine. Launch it once so the MCP config directory exists, then try again."
                    ),
                }
            }
            HarnessOperationError::Manager(ManagerError::ForeignEntry {
                server_name,
                config_path,
                ..
            }) => {
                tracing::warn!(harness = %harness, %server_name, path = %config_path.display(), "foreign harness entry exists");
                ConnectionState {
                    harness,
                    installed: false,
                    agent_id,
                    config_path: tildify_home_path(Some(&config_path), &self.home_dir),
                    message: format!(
                        "{harness} already has an entry under \"{server_name}\" that we did not write. Remove it from the config and try again."
                    ),
                }
            }
            error => {
                tracing::warn!(harness = %harness, %operation, error = %error, "harness operation failed");
                ConnectionState {
                    harness,
                    installed: operation == "disconnect",
                    agent_id,
                    config_path: None,
                    message: format!("Could not {operation} {harness}: {error}"),
                }
            }
        }
    }
}

/// Selects HTTP when the catalog supports it, otherwise wraps the URL with `mcp-remote`.
pub fn spec_for(agent: AgentId, mcp_url: &str) -> Result<McpServerSpec, ManagerError> {
    let surface = resolve_agent_surface(agent, AgentScope::System)?;
    if surface
        .supported_transports
        .contains(&agent_mcp_manager::McpTransport::Http)
    {
        return Ok(McpServerSpec::Http {
            url: mcp_url.to_string(),
            headers: BTreeMap::new(),
        });
    }
    Ok(McpServerSpec::Stdio {
        command: "npx".to_string(),
        args: vec!["mcp-remote".to_string(), mcp_url.to_string()],
        env: BTreeMap::new(),
    })
}

fn relink_managed_server(
    manager: &Manager,
    server_name: &str,
    agent: AgentId,
    spec: McpServerSpec,
    allow_overwrite: bool,
) -> Result<agent_mcp_manager::LinkSummary, HarnessOperationError> {
    let previous_spec = manager
        .list()
        .map_err(HarnessOperationError::Manager)?
        .into_iter()
        .find(|server| server.name == server_name)
        .map(|server| server.spec);
    let link = |spec| {
        let mut input = LinkInput::new(
            McpServer {
                name: server_name.to_string(),
                spec,
            },
            agent,
        );
        input.allow_overwrite = allow_overwrite;
        manager.link(input)
    };
    match link(spec) {
        Ok(summary) => Ok(summary),
        Err(relink_error) => {
            let Some(previous_spec) = previous_spec else {
                return Err(HarnessOperationError::Manager(relink_error));
            };
            match link(previous_spec) {
                Ok(_) => Err(HarnessOperationError::Manager(relink_error)),
                Err(restore_error) => Err(HarnessOperationError::Relink(format!(
                    "Could not relink {server_name}: {relink_error}; also failed to restore previous link: {restore_error}"
                ))),
            }
        }
    }
}

fn run_integrity_scan(manager: &Manager) -> Result<IntegrityScanOutcome, ManagerError> {
    let report = manager.rescan()?;
    let spec_by_name = manager
        .list()?
        .into_iter()
        .map(|server| (server.name, server.spec))
        .collect::<BTreeMap<_, _>>();
    let outcome_counts = (
        report.verified.len(),
        report.drifted.len(),
        report.missing.len(),
    );
    let mut to_heal = report.drifted;
    to_heal.extend(report.missing);
    let mut healed = 0;
    let mut failed = 0;

    for entry in to_heal {
        let Some(spec) = spec_by_name.get(&entry.server_name).cloned() else {
            failed += 1;
            tracing::warn!(
                server_name = %entry.server_name,
                agent = %entry.agent,
                reason = %entry.reason,
                "integrity scan found no manifest spec"
            );
            continue;
        };
        let mut input = LinkInput::new(
            McpServer {
                name: entry.server_name.clone(),
                spec,
            },
            entry.agent,
        );
        input.scope = entry.scope;
        input.allow_overwrite = true;
        match manager.link(input) {
            Ok(_) => {
                healed += 1;
                tracing::info!(
                    server_name = %entry.server_name,
                    agent = %entry.agent,
                    reason = %entry.reason,
                    "integrity scan healed entry"
                );
            }
            Err(error) => {
                failed += 1;
                tracing::warn!(server_name = %entry.server_name, agent = %entry.agent, %error, "integrity scan heal failed");
            }
        }
    }

    Ok(IntegrityScanOutcome {
        verified: outcome_counts.0,
        drifted: outcome_counts.1,
        missing: outcome_counts.2,
        healed,
        failed,
    })
}

fn tildify_home_path(path: Option<&Path>, home_dir: &Path) -> Option<String> {
    let path = path?;
    if path == home_dir {
        return Some("~".to_string());
    }
    match path.strip_prefix(home_dir) {
        Ok(relative) => Some(format!("~/{}", relative.display())),
        Err(_) => Some(path.display().to_string()),
    }
}

fn manager_app_error(error: ManagerError) -> AppError {
    AppError::Internal(error.to_string())
}

#[derive(Debug)]
enum HarnessOperationError {
    Manager(ManagerError),
    Relink(String),
}

impl fmt::Display for HarnessOperationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Manager(error) => error.fmt(formatter),
            Self::Relink(message) => formatter.write_str(message),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(source: std::io::Error) -> Self {
        Self::Io { path: None, source }
    }
}
