use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::{ToolDescriptor, ToolKind};

pub const BUILTIN_PROVIDER_ID: &str = "forgeone.builtin";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolProviderSource {
    Builtin,
    WorkspaceManifest { manifest_path: PathBuf },
    RuntimeRegistration,
}

impl ToolProviderSource {
    pub fn summary(&self) -> String {
        match self {
            Self::Builtin => "builtin".to_string(),
            Self::WorkspaceManifest { manifest_path } => {
                format!("manifest:{}", manifest_path.display())
            }
            Self::RuntimeRegistration => "runtime_registration".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolProviderDescriptor {
    pub provider_id: String,
    pub display_name: String,
    pub kind: ToolKind,
    pub version: Option<String>,
    pub description: String,
    pub source: ToolProviderSource,
}

impl ToolProviderDescriptor {
    pub fn builtin() -> Self {
        Self {
            provider_id: BUILTIN_PROVIDER_ID.to_string(),
            display_name: "ForgeOne Builtins".to_string(),
            kind: ToolKind::Builtin,
            version: None,
            description: "Builtin tools registered by the ForgeOne Tool Runtime".to_string(),
            source: ToolProviderSource::Builtin,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredToolDescriptor {
    pub provider: ToolProviderDescriptor,
    pub tool: ToolDescriptor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredExtension {
    pub provider: ToolProviderDescriptor,
    pub entrypoint: Option<String>,
    pub required_permissions: Vec<String>,
    pub tools: Vec<ToolDescriptor>,
}

impl DiscoveredExtension {
    pub fn manifest_path(&self) -> Option<&Path> {
        match &self.provider.source {
            ToolProviderSource::WorkspaceManifest { manifest_path } => {
                Some(manifest_path.as_path())
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionSurface {
    Mcp,
    Plugin,
    Skill,
}

impl ExtensionSurface {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::Plugin => "plugin",
            Self::Skill => "skill",
        }
    }

    pub fn directory_name(&self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::Plugin => "plugins",
            Self::Skill => "skills",
        }
    }

    pub fn tool_kind(&self) -> ToolKind {
        match self {
            Self::Mcp => ToolKind::Mcp,
            Self::Plugin => ToolKind::Plugin,
            Self::Skill => ToolKind::Skill,
        }
    }
}

impl fmt::Display for ExtensionSurface {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Deserialize)]
struct ExtensionManifest {
    api_version: Option<String>,
    name: String,
    display_name: Option<String>,
    kind: String,
    version: Option<String>,
    description: String,
    entrypoint: Option<String>,
    required_permissions: Option<Vec<String>>,
    tools: Vec<DeclaredToolManifest>,
}

#[derive(Debug, Deserialize)]
struct DeclaredToolManifest {
    tool_name: String,
    description: String,
    required_permissions: Option<Vec<String>>,
}

pub fn discover_workspace_extensions(
    workspace_root: impl AsRef<Path>,
) -> Result<Vec<DiscoveredExtension>, String> {
    let mut discovered = Vec::new();

    for surface in [
        ExtensionSurface::Mcp,
        ExtensionSurface::Plugin,
        ExtensionSurface::Skill,
    ] {
        let directory = workspace_root
            .as_ref()
            .join(".forgeone")
            .join(surface.directory_name());
        if !directory.exists() {
            continue;
        }

        let entries = fs::read_dir(&directory)
            .map_err(|error| format!("failed to read {}: {error}", directory.display()))?;

        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "failed to read manifest entry under {}: {error}",
                    directory.display()
                )
            })?;
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json")
            {
                continue;
            }

            discovered.push(parse_extension_manifest(surface, &path)?);
        }
    }

    discovered.sort_by(|left, right| {
        left.provider
            .kind
            .as_str()
            .cmp(right.provider.kind.as_str())
            .then(left.provider.provider_id.cmp(&right.provider.provider_id))
    });

    Ok(discovered)
}

fn parse_extension_manifest(
    expected_surface: ExtensionSurface,
    manifest_path: &Path,
) -> Result<DiscoveredExtension, String> {
    let content = fs::read_to_string(manifest_path)
        .map_err(|error| format!("failed to read {}: {error}", manifest_path.display()))?;
    let manifest: ExtensionManifest = serde_json::from_str(&content)
        .map_err(|error| format!("invalid json in {}: {error}", manifest_path.display()))?;

    if let Some(api_version) = &manifest.api_version
        && api_version != "forgeone/v1"
    {
        return Err(format!(
            "unsupported api_version={} in {}",
            api_version,
            manifest_path.display()
        ));
    }

    let kind = ToolKind::from_manifest_value(&manifest.kind).ok_or_else(|| {
        format!(
            "unsupported kind={} in {}",
            manifest.kind,
            manifest_path.display()
        )
    })?;
    if kind != expected_surface.tool_kind() {
        return Err(format!(
            "manifest kind={} does not match {} directory for {}",
            manifest.kind,
            expected_surface,
            manifest_path.display()
        ));
    }

    let provider = ToolProviderDescriptor {
        provider_id: manifest.name.clone(),
        display_name: manifest
            .display_name
            .unwrap_or_else(|| manifest.name.clone()),
        kind,
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        source: ToolProviderSource::WorkspaceManifest {
            manifest_path: manifest_path.to_path_buf(),
        },
    };

    let tools = manifest
        .tools
        .into_iter()
        .map(|tool| ToolDescriptor {
            tool_name: tool.tool_name,
            description: tool.description,
            kind,
            required_permissions: tool.required_permissions.unwrap_or_default(),
        })
        .collect();

    Ok(DiscoveredExtension {
        provider,
        entrypoint: manifest.entrypoint,
        required_permissions: manifest.required_permissions.unwrap_or_default(),
        tools,
    })
}
