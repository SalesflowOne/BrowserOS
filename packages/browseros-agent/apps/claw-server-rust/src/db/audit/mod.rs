pub mod entities;
mod migration;

use crate::{db::open_and_migrate, error::AppResult};
use migration::AuditMigrator;
use sea_orm::DatabaseConnection;
use std::path::Path;

#[derive(Clone)]
pub struct AuditDb(DatabaseConnection);

impl AuditDb {
    /// Opens and migrates the audit database.
    pub async fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        open_and_migrate::<AuditMigrator>(path.as_ref())
            .await
            .map(Self)
    }

    pub(crate) fn connection(&self) -> &DatabaseConnection {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::AuditDb;
    use sea_orm::{ConnectionTrait, DbBackend, Statement};
    use std::collections::HashSet;
    use tempfile::tempdir;

    #[tokio::test]
    async fn fresh_file_has_the_complete_baseline_schema() -> anyhow::Result<()> {
        let dir = tempdir()?;
        let db = AuditDb::open(dir.path().join("audit.sqlite")).await?;
        let objects = db
            .connection()
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'index')".to_string(),
            ))
            .await?;
        let names = objects
            .into_iter()
            .map(|row| row.try_get::<String>("", "name"))
            .collect::<Result<HashSet<_>, _>>()?;

        for table in [
            "tool_dispatches",
            "agent_session_starts",
            "agent_session_ends",
            "tasks",
            "seaql_migrations",
        ] {
            assert!(names.contains(table), "missing table {table}");
        }
        for index in [
            "tool_dispatches_created_at_idx",
            "tool_dispatches_agent_created_idx",
            "tool_dispatches_session_idx",
            "agent_session_starts_session_idx",
            "agent_session_starts_created_at_idx",
            "agent_session_ends_session_idx",
            "agent_session_ends_created_at_idx",
            "tasks_cursor_idx",
            "tasks_agent_cursor_idx",
            "tasks_status_cursor_idx",
            "tasks_site_cursor_idx",
            "tasks_started_idx",
        ] {
            assert!(names.contains(index), "missing index {index}");
        }

        let migrations = db
            .connection()
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT version FROM seaql_migrations".to_string(),
            ))
            .await?;
        assert_eq!(migrations.len(), 1);
        assert_eq!(
            migrations[0].try_get::<String>("", "version")?,
            "m0001_baseline"
        );
        Ok(())
    }
}
