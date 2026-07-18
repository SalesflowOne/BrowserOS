pub mod app;
pub mod config;
pub mod db;
pub mod domain;
pub mod error;
pub mod ids;
pub mod mcp;
pub mod routes;
pub mod services;
pub mod storage;

pub use app::{AppState, build_router};
