pub mod activity;
mod colors;
mod ownership;
pub mod targets;

pub use colors::{TabGroupColor, color_for_slug, hex_for_slug};
pub use ownership::{PageOwnership, TabGroup, TabGroupState, TitleSync};
