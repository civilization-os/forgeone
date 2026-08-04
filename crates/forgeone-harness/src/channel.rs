use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub session_id: String,
    pub content: String,
    pub role: String,
}

#[async_trait]
pub trait Channel: Send + Sync {
    fn name(&self) -> &str;
    async fn send_message(&self, msg: Message) -> Result<(), String>;
    async fn receive_message(&self) -> Result<Message, String>;
}

pub struct ChannelRouter {
    channels: std::collections::HashMap<String, Box<dyn Channel>>,
}

impl Default for ChannelRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl ChannelRouter {
    pub fn new() -> Self {
        Self {
            channels: std::collections::HashMap::new(),
        }
    }

    pub fn register_channel(&mut self, channel: Box<dyn Channel>) {
        self.channels.insert(channel.name().to_string(), channel);
    }
    
    // In V1, we route outbound messages from an Agent to a specified channel
    pub async fn route_outbound(&self, channel_name: &str, msg: Message) -> Result<(), String> {
        if let Some(channel) = self.channels.get(channel_name) {
            channel.send_message(msg).await
        } else {
            Err(format!("Channel {} not found", channel_name))
        }
    }
}
