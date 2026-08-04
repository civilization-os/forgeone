use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    pub prompt: String,
    pub model_name: String,
    pub token_budget: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceResponse {
    pub content: String,
    pub tokens_used: u32,
}

#[async_trait]
pub trait ModelProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn request_inference(&self, req: InferenceRequest) -> Result<InferenceResponse, String>;
}

pub struct ModelManager {
    providers: HashMap<String, Box<dyn ModelProvider>>,
}

impl Default for ModelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ModelManager {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    pub fn register_provider(&mut self, provider: Box<dyn ModelProvider>) {
        self.providers.insert(provider.name().to_string(), provider);
    }

    pub async fn request_inference(&self, req: InferenceRequest) -> Result<InferenceResponse, String> {
        // Find the right provider based on model_name prefix or mapping.
        // For V1, we'll pick the provider that matches the prefix, or just fallback to the first one.
        for (name, provider) in &self.providers {
            if req.model_name.starts_with(name) {
                return provider.request_inference(req).await;
            }
        }
        
        if let Some(provider) = self.providers.values().next() {
            provider.request_inference(req).await
        } else {
            Err("No model providers registered".to_string())
        }
    }
}
