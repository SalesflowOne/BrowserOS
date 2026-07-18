pub mod agent_ref;
pub mod ownership;
pub mod registry;
pub mod session;
pub mod session_identity;

pub use crate::ids::{ConvoId, DispatchId, ProfileId, SessionId};
pub use agent_ref::{AgentRef, ClientInfo};
pub use ownership::{AgentKey, AgentPageOwnership};
pub use registry::{RetainedGroupAction, SessionRegistry};
pub use session::{Session, TabGroupColor, color_for_slug, hex_for_slug};
pub use session_identity::{GenerateFunNameError, SessionIdentity, generate_fun_name};
