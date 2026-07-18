use super::{error, internal};
use crate::{AppState, error::CanonicalError, error::RequestId};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
};
use claw_api::models::{
    HealthResponse, ShutdownResponse, SystemInfo, TelemetryState, UpdateTelemetryRequest,
};

pub(super) async fn health() -> Json<HealthResponse> {
    Json(HealthResponse::default())
}

pub(super) async fn shutdown(
    Extension(request_id): Extension<RequestId>,
    State(state): State<AppState>,
) -> Result<Json<ShutdownResponse>, CanonicalError> {
    state
        .sessions
        .shutdown()
        .await
        .map_err(|source| internal(&request_id, source))?;
    state.screencast.stop();
    state.browser.stop();
    if let Some(tx) = state.shutdown.lock().await.take() {
        let _ = tx.send(());
    }
    Ok(Json(ShutdownResponse::default()))
}

pub(super) async fn info(State(state): State<AppState>) -> Json<SystemInfo> {
    Json(SystemInfo::new(
        "BrowserClaw".to_string(),
        env!("CARGO_PKG_VERSION").to_string(),
        state.config.local_server_url(),
    ))
}

pub(super) async fn telemetry(State(state): State<AppState>) -> Json<TelemetryState> {
    Json(to_contract_state(state.telemetry.get_state().await))
}

pub(super) async fn update_telemetry(
    Extension(request_id): Extension<RequestId>,
    State(state): State<AppState>,
    payload: Result<Json<UpdateTelemetryRequest>, JsonRejection>,
) -> Result<Json<TelemetryState>, CanonicalError> {
    let Json(payload) = payload.map_err(|_| {
        error(
            &request_id,
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "consent must be a boolean",
        )
    })?;
    Ok(Json(to_contract_state(
        state.telemetry.set_consent(payload.consent).await,
    )))
}

fn to_contract_state(state: crate::services::telemetry::TelemetryState) -> TelemetryState {
    TelemetryState::new(state.distinct_id, state.enabled, state.consent)
}
