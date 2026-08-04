use std::collections::HashMap;
use forgeone_runtime::RuntimeCore;
use forgeone_model::ModelManager;
use std::sync::Arc;

pub struct AgentInstance {
    pub session_id: String,
    pub runtime: RuntimeCore,
}

pub struct AgentManager {
    instances: HashMap<String, AgentInstance>,
    model_manager: Arc<ModelManager>,
}

impl AgentManager {
    pub fn new(model_manager: Arc<ModelManager>) -> Self {
        Self {
            instances: HashMap::new(),
            model_manager,
        }
    }

    pub fn spawn_agent(&mut self, session_id: &str) -> Result<(), String> {
        if self.instances.contains_key(session_id) {
            return Err("Agent with this session ID already exists".to_string());
        }

        // We create a new RuntimeCore for this agent session
        let runtime = RuntimeCore::default();
        
        self.instances.insert(
            session_id.to_string(),
            AgentInstance {
                session_id: session_id.to_string(),
                runtime,
            },
        );
        Ok(())
    }

    pub fn get_agent(&self, session_id: &str) -> Option<&AgentInstance> {
        self.instances.get(session_id)
    }
    
    pub fn model_manager(&self) -> Arc<ModelManager> {
        self.model_manager.clone()
    }
}
