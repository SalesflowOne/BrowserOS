use crate::{
    app::AppState,
    dispatch::{DispatchInput, DispatchPipeline},
    domain::{AgentRef, ClientInfo, SessionId},
    error::{AppError, AppResult},
};
use axum::{
    Json,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use browseros_mcp::{BROWSER_MCP_INSTRUCTIONS, ToolDef, catalog};
use serde_json::{Value, json};
use ulid::Ulid;

const HEADER_MCP_SESSION_ID: &str = "mcp-session-id";
const SERVER_NAME: &str = "browseros-claw-server";
const SERVER_TITLE: &str = "BrowserOS";

pub async fn mcp_endpoint(State(state): State<AppState>, req: Request<Body>) -> Response {
    match handle_mcp_request(state, req).await {
        Ok(response) => response,
        Err(err) => err.into_response(),
    }
}

async fn handle_mcp_request(state: AppState, req: Request<Body>) -> AppResult<Response> {
    let method = req.method().clone();
    let headers = req.headers().clone();
    match method {
        Method::POST => handle_post(state, headers, req).await,
        Method::DELETE => handle_delete(state, headers).await,
        _ => Ok((
            StatusCode::METHOD_NOT_ALLOWED,
            Json(json!({ "error": "method not allowed" })),
        )
            .into_response()),
    }
}

async fn handle_post(
    state: AppState,
    headers: HeaderMap,
    req: Request<Body>,
) -> AppResult<Response> {
    let body = to_bytes(req.into_body(), 16 * 1024 * 1024)
        .await
        .map_err(|err| AppError::bad_request(format!("invalid request body: {err}")))?;
    let message: Value = serde_json::from_slice(&body)
        .map_err(|err| AppError::bad_request(format!("invalid JSON-RPC request: {err}")))?;
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let header_session_id = session_id_header(&headers);
    if let Some(session_id) = header_session_id {
        let session_id = SessionId::new(session_id);
        let Some(session) = state.sessions.lookup(&session_id).await else {
            return Ok(unknown_session_response());
        };
        session.touch(tokio::time::Instant::now()).await;
        return match method {
            "notifications/initialized" => Ok(StatusCode::ACCEPTED.into_response()),
            "ping" => Ok(json_rpc_response(id, json!({}))),
            "tools/list" => Ok(json_rpc_response(id, json!({ "tools": mcp_tools() }))),
            "tools/call" => {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                let Some(tool_name) = params.get("name").and_then(Value::as_str) else {
                    return Ok(json_rpc_error(
                        id,
                        -32602,
                        "tools/call requires params.name",
                    ));
                };
                let Some(tool) = find_tool(tool_name) else {
                    return Ok(json_rpc_error(id, -32601, "unknown tool"));
                };
                let raw_args = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let pipeline = DispatchPipeline::new(state.clone());
                let result = pipeline
                    .dispatch(DispatchInput {
                        session,
                        tool: &tool,
                        raw_args,
                        browser_session: state.browser.session().await,
                    })
                    .await
                    .into_call_tool_result();
                Ok(json_rpc_response(
                    id,
                    serde_json::to_value(result).unwrap_or_else(|err| {
                        tracing::warn!(error = %err, "tool result serialization failed");
                        json!({
                            "content": [{ "type": "text", "text": "tool result serialization failed" }],
                            "isError": true
                        })
                    }),
                ))
            }
            _ => Ok(json_rpc_error(id, -32601, "method not found")),
        };
    }

    if method != "initialize" {
        return Ok(json_rpc_error(
            id,
            -32000,
            "initialize without mcp-session-id is required to start a session",
        ));
    }
    let response = initialize_session(state, &message, id).await?;
    Ok(response)
}

async fn handle_delete(state: AppState, headers: HeaderMap) -> AppResult<Response> {
    let Some(session_id) = session_id_header(&headers) else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "mcp-session-id header is required" })),
        )
            .into_response());
    };
    let removed = state
        .sessions
        .remove(&SessionId::new(session_id), "closed", Some("client delete"))
        .await?;
    if !removed {
        return Ok(unknown_session_response());
    }
    Ok(StatusCode::ACCEPTED.into_response())
}

async fn initialize_session(state: AppState, message: &Value, id: Value) -> AppResult<Response> {
    let session_id = SessionId::new(Ulid::new().to_string());
    let client = client_info(message);
    let profiles = state.agents.list_profiles().await?;
    let agent = AgentRef::resolve(&session_id, &client, &profiles);
    let session = state
        .sessions
        .mint_with_id(session_id.clone(), agent, client)
        .await?;
    let requested_protocol = message
        .get("params")
        .and_then(|params| params.get("protocolVersion"))
        .and_then(Value::as_str)
        .unwrap_or("2025-11-25");
    let body = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": requested_protocol,
            "capabilities": {
                "tools": { "listChanged": true },
                "logging": {}
            },
            "serverInfo": {
                "name": SERVER_NAME,
                "title": SERVER_TITLE,
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": BROWSER_MCP_INSTRUCTIONS
        }
    });
    tracing::info!(
        session_id = %session.id(),
        agent = %session.agent().agent_id(),
        "mcp session initialized"
    );
    let mut response = (StatusCode::OK, Json(body)).into_response();
    if let Ok(value) = HeaderValue::from_str(session.id().as_str()) {
        response.headers_mut().insert(HEADER_MCP_SESSION_ID, value);
    }
    Ok(response)
}

fn client_info(message: &Value) -> ClientInfo {
    let client = message
        .get("params")
        .and_then(|params| params.get("clientInfo"));
    ClientInfo {
        name: client
            .and_then(|client| client.get("name"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("agent")
            .to_string(),
        version: client
            .and_then(|client| client.get("version"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        title: client
            .and_then(|client| client.get("title"))
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn session_id_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get(HEADER_MCP_SESSION_ID)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn unknown_session_response() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "unknown mcp-session-id",
            "hint": "drop the mcp-session-id header and send an initialize request to start a new session"
        })),
    )
        .into_response()
}

fn json_rpc_response(id: Value, result: Value) -> Response {
    (
        StatusCode::OK,
        Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })),
    )
        .into_response()
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Response {
    (
        StatusCode::OK,
        Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        })),
    )
        .into_response()
}

fn mcp_tools() -> Vec<Value> {
    catalog()
        .iter()
        .filter_map(|tool| serde_json::to_value(tool.to_mcp_tool()).ok())
        .collect()
}

fn find_tool(name: &str) -> Option<ToolDef> {
    catalog().into_iter().find(|tool| tool.name == name)
}

#[allow(dead_code)]
fn _headers(_: header::HeaderName) {}
