---
name: plugin-architecture
description: Design and implement plugins for the CPAP Analyzer extension system. Use when adding new machine support, analysis methods, visualizations, integrations, or export formats.
metadata:
  version: '1.0'
---

# Plugin Architecture

The CPAP Analyzer uses a plugin architecture for extensibility. All major feature categories are implemented as plugins.

## Plugin Categories

| Category          | Purpose                                                     | Examples                                  |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------- |
| **Machine**       | Data import and parsing for a specific machine manufacturer | ResMed, Philips Respironics               |
| **Analysis**      | Statistical analysis or derived metric computation          | Trend analysis, clustering, correlation   |
| **Visualization** | Chart or visualization component                            | Time-series plot, heatmap, survival curve |
| **Integration**   | External service connection                                 | Fitbit, weather API, LLM                  |
| **Export**        | Data export format                                          | PDF report, CSV, session backup           |

## Plugin Structure

Each plugin is a self-contained module that registers with the plugin system:

- Declares its type and capabilities
- Provides metadata (name, version, description, author)
- Exports a registration function
- Can depend on core APIs but not on other plugins directly

## Design Principles

- **Self-contained**: A plugin should work independently. Removing a plugin should not break the application.
- **Lazy-loaded**: Plugins should be loaded on demand to minimize initial bundle size.
- **Typed**: Plugin interfaces are fully typed with TypeScript. Plugins must conform to their category's interface.
- **Discoverable**: The plugin system provides registration, enumeration, and capability queries.
- **Testable**: Plugins should be testable in isolation from the rest of the application.

## Adding a New Plugin

1. Create a new directory under the appropriate plugin category
2. Implement the required interface for that plugin category
3. Export a registration function
4. Write unit tests for the plugin
5. Document the plugin's purpose and configuration
6. Register in the plugin manifest
