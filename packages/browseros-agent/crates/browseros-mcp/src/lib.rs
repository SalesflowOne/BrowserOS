pub mod constants;
pub mod format;
pub mod framework;
pub mod output_file;
pub mod response;
pub mod service;
pub mod tools;
pub mod trust_boundary;

#[cfg(test)]
mod tests;

pub use framework::{
    BrowserToolDefaults, BrowserToolOptions, OutputFileAccess, ToolCtx, ToolDef, catalog,
    execute_tool,
};
pub use service::{BROWSER_MCP_INSTRUCTIONS, BrowserMcpService, BrowserMcpServiceOptions};
