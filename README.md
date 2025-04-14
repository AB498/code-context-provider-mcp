# Code Context MCP

A Model Context Protocol (MCP) server that provides code context and analysis for AI assistants.

## Features

- Generate directory tree structure
- Analyze JavaScript/TypeScript and Python files
- Extract code symbols (functions, variables, classes, imports, exports)
- Compatible with the MCP protocol for seamless integration with AI assistants

## Installation

### Global Installation

```bash
npm install -g code-context-provider-mcp
```

### Using npx (No Installation)

```bash
npx code-context-provider-mcp
```

## WASM Parsers Setup

This MCP uses WebAssembly (WASM) versions of Tree-sitter parsers instead of native modules, which avoids requiring Visual Studio C++ or other build tools.

### Automatic Setup (Recommended)

Run the setup script to automatically download the WASM parsers:

```bash
npm run setup
```

Or if installed globally:

```bash
npx code-context-provider-mcp-setup
```

### Manual Setup

If you prefer to manually download the parsers:

1. Create a `parsers` directory in the same location as the installed package
2. Download the WASM files for the languages you want to support:
   - JavaScript: [tree-sitter-javascript.wasm](https://github.com/tree-sitter/tree-sitter-javascript/releases)
   - Python: [tree-sitter-python.wasm](https://github.com/tree-sitter/tree-sitter-python/releases)
3. Place the downloaded WASM files in the `parsers` directory

If you installed the package globally, the parsers directory should be located in your global node_modules folder.

## Usage

After starting the server, you can use it as an MCP provider with any compatible MCP client.

The server provides the following tools:

### `getContext`

Analyzes a directory and returns its structure along with code symbols (optional).

Parameters:
- `absolutePath` (string, required): Absolute path to the directory to analyze
- `analyzeJs` (boolean, optional): Whether to analyze JavaScript/TypeScript and Python files (default: false)
- `includeSymbols` (boolean, optional): Whether to include code symbols in the response (default: false)
- `symbolType` (enum, optional): Type of symbols to include if includeSymbols is true (options: 'functions', 'variables', 'classes', 'imports', 'exports', 'all', default: 'all')
- `filePatterns` (array of strings, optional): File patterns to analyze (e.g. ['*.js', '*.py', 'config.*']). This allows analyzing specific files in a project, including files that aren't JavaScript or Python.
- `maxDepth` (number, optional): Maximum directory depth to analyze (default: 5 levels). Useful for large projects to prevent analyzing too many directories.

Note: Anonymous functions are automatically filtered out of the results.

## File Pattern Examples

You can use the `filePatterns` parameter to specify which files to analyze. This is useful for complex projects with multiple languages or specific files of interest.

Examples:
- `["*.js", "*.py"]` - Analyze all JavaScript and Python files
- `["config.*"]` - Analyze all configuration files regardless of extension
- `["package.json", "*.config.js"]` - Analyze package.json and any JavaScript config files
- `[".ts", ".tsx", ".py"]` - Analyze TypeScript and Python files (using extension format)

The file pattern matching supports:
- Simple glob patterns with wildcards (*)
- Direct file extensions (with or without the dot)
- Exact file names

## Handling Large Projects

For very large projects, you can use the `maxDepth` parameter to limit how deeply the tool will traverse directories:

- `maxDepth: 2` - Only analyze the root directory and one level of subdirectories
- `maxDepth: 3` - Analyze the root, and two levels of subdirectories
- `maxDepth: 0` - Only analyze files in the root directory

This is particularly useful when:
- Working with large monorepos
- Analyzing projects with many dependencies
- Focusing only on the main source code and not third-party libraries

## Supported Languages

Code symbol analysis is supported for:
- JavaScript (.js)
- JSX (.jsx)
- TypeScript (.ts)
- TSX (.tsx)
- Python (.py)

Using the `filePatterns` parameter allows you to include other file types in the directory structure, though symbolic analysis may be limited.

## License

MIT

## Publishing

When publishing this package to npm, the WASM files are not included directly in the package to keep the package size small. Instead, they are automatically downloaded during installation.

### Publishing Process

1. Update the version in package.json
2. Run `npm publish`

The `prepublishOnly` script will ensure that the WASM files are properly handled during the publishing process.

### Post-Installation

After installation, the package's `prepare` script automatically runs to download the WASM parsers. If for some reason the download fails, users can manually run the setup:

```bash
npx code-context-provider-mcp-setup
```

### For Package Maintainers

If you need to update the WASM files or add support for new languages:

1. Add the new language to the `SUPPORTED_LANGUAGES` object in index.js
2. Add the WASM file URL to the `PARSERS` array in setup.js
3. Update the README.md with information about the new supported language 