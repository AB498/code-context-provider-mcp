# Code Context Provider MCP

### MCP server that provides code context and analysis for AI assistants. Extracts directory structure and code symbols using WebAssembly Tree-sitter parsers with Zero Native Dependencies.

<div style="text-align:center;font-family: monospace; display: flex; align-items: center; justify-content: center; width: 100%; gap: 10px">
        <a href="https://discord.gg/dquNGYwfnW"><img src="https://img.shields.io/discord/1095854826786668545" alt="Discord"></a>
        <a href="https://img.shields.io/badge/License-MIT-yellow.svg"><img
                src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
        <a href="https://www.npmjs.com/package/code-context-provider-mcp"><img src="https://img.shields.io/npm/v/code-context-provider-mcp" alt="npm"></a>
</div>

---

## Features

- Generate directory tree structure
- Analyze JavaScript/TypeScript and Python files
- Extract code symbols (functions, variables, classes, imports, exports)
- Compatible with the MCP protocol for seamless integration with AI assistants

## Quick Usage (MCP Setup)

### Windows

```json
{
  "mcpServers": {
    "code-context-provider-mcp": {
      "command": "cmd.exe",
      "args": [
        "/c",
        "npx",
        "-y",
        "code-context-provider-mcp@latest"
      ]
    }
  }
}
```

### MacOS/Linux

```json
{
  "mcpServers": {
    "code-context-provider-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "code-context-provider-mcp@latest"
      ]
    }
  }
}
```

OR install globally with `npm`:
```bash
npm install -g code-context-provider-mcp
```
Then use it by running:
```bash
code-context-provider-mcp # if you're not using @latest, you may want to clear the cache for latest version using `Remove-Item -Path "$env:LOCALAPPDATA\npm-cache\_npx" -Recurse -Force` for windows and `rm -rf ~/.npm/_npx` for linux/macos
```

## Available Tools

### `getContext`

Analyzes a directory and returns its structure along with code symbols (optional).

Parameters:
- `absolutePath` (string, required): Absolute path to the directory to analyze
- `analyzeJs` (boolean, optional): Whether to analyze JavaScript/TypeScript and Python files (default: false)
- `includeSymbols` (boolean, optional): Whether to include code symbols in the response (default: false)
- `symbolType` (enum, optional): Type of symbols to include if includeSymbols is true (options: 'functions', 'variables', 'classes', 'imports', 'exports', 'all', default: 'all')
- `filePatterns` (array of strings, optional): File patterns to analyze (e.g. ['*.js', '*.py', 'config.*'])
- `maxDepth` (number, optional): Maximum directory depth to analyze (default: 5 levels)

Note: Anonymous functions are automatically filtered out of the results.

## Example Output Text On Tool Call

```
Directory structure for: C:\Users\Admin\Desktop\mcp\context-provider-mcp

Code Analysis Summary:
- Files analyzed: 3
- Total functions: 29
- Total variables: 162
- Total classes: 0

Note: Symbol analysis is supported for JavaScript/TypeScript (.js, .jsx, .ts, .tsx) and Python (.py) files only.

Code analysis limited to a maximum depth of 5 directory levels (default).

├── index.js (39 KB)
│   └── [Analyzed: 22 functions, 150 variables, 0 classes]
│       Functions:
│       - initializeTreeSitter [39:0]
│       - getLanguageFromExtension [107:0]
│       - getPosition [138:24]
```


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

## Development

### Setting up the Development Environment

```bash
# Clone the repository
git clone https://github.com/your-username/code-context-provider-mcp.git
cd code-context-provider-mcp

# Install dependencies
npm install

# Set up WASM parsers
npm run setup
```

### Post-Installation

After installation, the package's `prepare` script automatically runs to download the WASM parsers. If for some reason the download fails, users can manually run the setup:

```bash
npx code-context-provider-mcp-setup
```

## License

MIT

## For more information or help

- [Email (abcd49800@gmail.com)](mailto:abcd49800@gmail.com)
- [Discord (CodePlayground)](https://discord.gg/dquNGYwfnW)
