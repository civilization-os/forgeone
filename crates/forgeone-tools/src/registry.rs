use std::collections::HashMap;
use std::sync::Arc;

use crate::agent_tools::*;
use crate::extensions::*;
use crate::fs_tools::*;
use crate::shell_tools::*;
use crate::types::*;
use crate::util::now_ms;

#[derive(Default)]
pub struct ToolRegistry {
    executors: HashMap<String, Arc<dyn ToolExecutor>>,
    providers: HashMap<String, ToolProviderDescriptor>,
    tool_providers: HashMap<String, String>,
}

impl ToolRegistry {
    pub fn with_builtin_tools() -> Self {
        let mut registry = Self::default();
        registry
            .register_provider(ToolProviderDescriptor::builtin())
            .expect("builtin provider registration should succeed");
        registry.register(ReadFileTool);
        registry.register(SearchContentTool);
        registry.register(SearchFilesTool);
        registry.register(WriteFileTool);
        registry.register(ShellTool);
        registry.register(EditFileTool);
        registry.register(GlobTool);
        registry.register(DirectoryTreeTool);
        registry.register(GitTool);
        registry.register(DiagnosticsTool);
        registry.register(DiffTool);
        registry.register(InvokeSubAgentTool);
        registry.register(SkillTool);
        registry
    }

    pub fn register<T>(&mut self, tool: T)
    where
        T: ToolExecutor + 'static,
    {
        self.ensure_builtin_provider();
        self.register_with_provider(BUILTIN_PROVIDER_ID, tool)
            .expect("builtin tool registration should succeed");
    }

    pub fn register_provider(&mut self, provider: ToolProviderDescriptor) -> Result<(), String> {
        if let Some(existing) = self.providers.get(&provider.provider_id) {
            if existing != &provider {
                return Err(format!(
                    "provider={} already registered with different metadata",
                    provider.provider_id
                ));
            }
            return Ok(());
        }

        self.providers
            .insert(provider.provider_id.clone(), provider);
        Ok(())
    }

    pub fn register_with_provider<T>(&mut self, provider_id: &str, tool: T) -> Result<(), String>
    where
        T: ToolExecutor + 'static,
    {
        let descriptor = tool.descriptor();
        self.register_executor(provider_id, descriptor, Arc::new(tool))
    }

    pub fn provider_descriptors(&self) -> Vec<ToolProviderDescriptor> {
        let mut list: Vec<ToolProviderDescriptor> = self.providers.values().cloned().collect();
        list.sort_by(|a, b| a.provider_id.cmp(&b.provider_id));
        list
    }

    pub fn descriptors(&self) -> Vec<ToolDescriptor> {
        let mut list: Vec<ToolDescriptor> = self
            .executors
            .values()
            .map(|executor| executor.descriptor())
            .collect();
        list.sort_by(|a, b| a.tool_name.cmp(&b.tool_name));
        list
    }

    pub fn registered_tools(&self) -> Vec<RegisteredToolDescriptor> {
        let mut list = Vec::new();
        for tool in self.descriptors() {
            let Some(provider_id) = self.tool_providers.get(&tool.tool_name) else {
                continue;
            };
            let Some(provider) = self.providers.get(provider_id) else {
                continue;
            };

            list.push(RegisteredToolDescriptor {
                provider: provider.clone(),
                tool,
            });
        }
        list
    }

    pub fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let Some(executor) = self.executors.get(&request.tool_name) else {
            return ToolCallResult {
                call_id: request.call_id.clone(),
                status: ToolCallStatus::ValidationError,
                structured_output: HashMap::new(),
                error: Some(format!("unknown_tool={}", request.tool_name)),
                completed_at_ms: now_ms(),
            };
        };

        executor.execute(request)
    }

    fn register_executor(
        &mut self,
        provider_id: &str,
        descriptor: ToolDescriptor,
        executor: Arc<dyn ToolExecutor>,
    ) -> Result<(), String> {
        if !self.providers.contains_key(provider_id) {
            return Err(format!("provider={} is not registered", provider_id));
        }

        if let Some(existing_provider_id) = self.tool_providers.get(&descriptor.tool_name)
            && existing_provider_id != provider_id
        {
            return Err(format!(
                "tool={} already registered by provider={}",
                descriptor.tool_name, existing_provider_id
            ));
        }

        let tool_name = descriptor.tool_name.clone();
        self.executors.insert(tool_name.clone(), executor);
        self.tool_providers
            .insert(tool_name, provider_id.to_string());
        Ok(())
    }

    fn ensure_builtin_provider(&mut self) {
        if !self.providers.contains_key(BUILTIN_PROVIDER_ID) {
            self.providers.insert(
                BUILTIN_PROVIDER_ID.to_string(),
                ToolProviderDescriptor::builtin(),
            );
        }
    }
}

