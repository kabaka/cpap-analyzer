# 0007 — Plugin Architecture for Extensibility

## Status

Accepted

## Context

CPAP Analyzer must support extensibility for future machine manufacturers (Philips Respironics, Fisher & Paykel), custom analysis algorithms, new visualization types, and third-party integrations (Fitbit, weather APIs, LLM insights) without modifying core codebase.

Extension requirements:

- Support multiple CPAP machine manufacturers with different data formats
- Allow custom statistical analysis methods from clinical researchers
- Enable new visualization types for novel metrics
- Integrate external data sources (Fitbit sleep stages, environmental factors)
- Support new export formats (custom PDF templates, clinical reports)

Extension constraints:

- Client-side only (no server-side plugin hosting)
- Security isolation (plugins cannot access data beyond declared requirements)
- Type safety (plugins must integrate with TypeScript type system)
- Performance (plugins run in Web Workers for heavy computation)
- User control (users choose which plugins to install/enable)

Alternatives considered:

- **No plugin system**: Hardcode all supported machines and analyses. Rejected: not sustainable as new machines and research methods emerge; core team becomes bottleneck.
- **Server-side plugin marketplace**: Centralized plugin registry with version management. Rejected: conflicts with client-side-only architecture; introduces single point of failure; requires plugin hosting infrastructure.
- **iframe-based plugins**: Sandboxed isolation via iframes. Rejected: communication overhead high; complex data serialization; poor TypeScript integration.
- **WebAssembly plugins**: Maximum performance and language flexibility. Rejected: steep learning curve for plugin developers; complex WASM-JS interop; overkill for our use cases.
- **npm packages only**: Plugins distributed as npm packages, bundled at compile time. Rejected: requires rebuilding application to add plugins; no user choice at runtime.

## Decision

Implement **plugin architecture** with five plugin types:

1. **Machine Plugins**: Parse manufacturer-specific data formats (EDF, CSV, proprietary)
2. **Analysis Plugins**: Custom statistical algorithms and clinical metrics
3. **Visualization Plugins**: Novel chart types and dashboards
4. **Integration Plugins**: External data sources (Fitbit, weather, LLM)
5. **Export Plugins**: Custom report templates and output formats

Plugin interface contracts:

**Machine Plugin**:

```typescript
interface MachinePlugin {
  metadata: { id, name, version, manufacturer, supportedModels }
  detectMachine(files: File[]): Promise<boolean>
  parseSession(files: File[]): Promise<SessionData>
  getChannelMappings(): ChannelMapping[]
}
```

**Analysis Plugin**:

```typescript
interface AnalysisPlugin {
  metadata: { id, name, version, category }
  dataRequirements: { stores, signals, minSampleSize }
  parameterSchema: JSONSchema
  execute(input: AnalysisInput): Promise<AnalysisOutput>
  supportsIncremental?: boolean
}
```

**Visualization Plugin**:

```typescript
interface VisualizationPlugin {
  metadata: { id, name, version, category }
  dataRequirements: { analysisType, parameters }
  component: React.ComponentType<VisualizationProps>
  supportedExports?: ('png' | 'svg' | 'csv' | 'json')[]
}
```

Plugin discovery and loading:

- Plugins bundled at compile time as separate chunks (code-splitting)
- Lazy-loaded when user enables plugin in settings
- Plugin registry maintains installed plugins and metadata
- User explicitly enables/disables plugins

Plugin isolation:

- Analysis plugins run in Web Workers (no main thread access)
- Data access only through `DataProvider` interface (no direct IndexedDB/OPFS access)
- Network access requires user-granted permissions with whitelisted domains
- Plugins declare required capabilities in manifest; users approve at install

Plugin distribution:

- Core plugins (ResMed, basic analyses) bundled with application
- Community plugins distributed as separate npm packages
- Developers bundle plugins and provide installation instructions
- Future: plugin marketplace hosted as static site (JSON catalog)

## Consequences

### Positive

- Extensibility: Support new machines without modifying core code; ResMed, Philips, Fisher & Paykel can coexist
- Community contributions: Clinical researchers can implement custom algorithms without pull requests to main repo
- Type safety: TypeScript interfaces enforce plugin contracts at compile time
- Security: DataProvider abstraction prevents plugins from bypassing access controls or exfiltrating data
- Performance: Web Worker execution isolates heavy computation from UI
- Modularity: Core application remains focused; features moved to plugins
- User choice: Users install only plugins they need, reducing bundle size
- Testing isolation: Plugins tested independently from core application
- Version management: Plugins have independent versioning, can update without app update

### Negative

- Complexity: Plugin system adds architectural complexity and maintenance burden
- API stability: Plugin interfaces must remain stable; breaking changes disrupt ecosystem
- Documentation overhead: Plugin development requires comprehensive documentation and examples
- Type checking: Plugin type safety limited to declared interfaces; runtime validation needed
- Breaking changes: Core application updates may break plugins if interfaces change
- Security risk: Malicious plugins could access declared data inappropriately despite sandboxing
- Testing burden: Each plugin combination multiplies test surface area
- Discovery problem: No centralized marketplace initially; users must find plugins via documentation/community

### Neutral

- Plugin performance depends on implementation quality; bad plugins can degrade experience
- Community growth depends on documentation quality and developer experience
- Plugins require separate build pipeline and tooling
- Version compatibility matrix between app versions and plugin versions must be managed
