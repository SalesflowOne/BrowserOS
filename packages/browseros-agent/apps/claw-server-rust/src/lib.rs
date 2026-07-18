pub mod app;
pub mod config;
pub mod db;
pub mod error;
pub mod identity;
pub mod ids;
pub mod mcp;
pub mod routes;
pub mod runtime;
pub mod services;
pub mod sessions;
pub mod storage;
pub mod tabs;

pub use app::{AppState, build_router};
pub use runtime::{AppRuntime, ShutdownHandle};
