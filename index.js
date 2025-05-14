#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import * as url from 'url';
import TreeSitter from 'web-tree-sitter';

// WASM language parsers will be loaded dynamically
let Parser = null;
let initialized = false;
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

// Define supported languages and their WASM paths
const SUPPORTED_LANGUAGES = {
  'js': 'tree-sitter-javascript.wasm',
  'jsx': 'tree-sitter-javascript.wasm',
  'ts': 'tree-sitter-javascript.wasm',
  'tsx': 'tree-sitter-javascript.wasm',
  'py': 'tree-sitter-python.wasm'
};

// Language instances
const languageInstances = {};

// Global store for code symbols
const codeSymbols = {
  functions: {},  // Functions by file path
  variables: {},  // Variables by file path
  classes: {},    // Classes by file path
  imports: {},    // Imports by file path
  exports: {},    // Exports by file path
  files: new Set() // All analyzed files
};

// Initialize Tree-sitter with WASM
async function initializeTreeSitter() {
  if (initialized) return;

  try {
    await TreeSitter.init();
    Parser = TreeSitter;

    // Create language parsers
    const languages = new Set(Object.values(SUPPORTED_LANGUAGES));
    const parsersDir = ensureParsersDirectory();
    let missingWasmFiles = [];

    for (const wasmFile of languages) {
      try {
        const wasmPath = path.join(parsersDir, wasmFile);
        if (fs.existsSync(wasmPath)) {
          const lang = await TreeSitter.Language.load(wasmPath);
          languageInstances[wasmFile] = lang;
        } else {
          console.warn(`Warning: WASM parser not found at ${wasmPath}`);
          missingWasmFiles.push(wasmFile);
        }
      } catch (err) {
        console.error(`Failed to load language ${wasmFile}:`, err);
        missingWasmFiles.push(wasmFile);
      }
    }

    // Provide helpful error message if WASM files are missing
    if (missingWasmFiles.length > 0) {
      console.error(`\nMissing WASM parser files: ${missingWasmFiles.join(', ')}`);
      console.error(`\nPlease run the setup script to download them automatically:`);
      console.error(`  npx code-context-provider-mcp-setup`);
      console.error(`\nOr download the WASM files manually and place them in: ${parsersDir}`);
      console.error(`- JavaScript: https://github.com/tree-sitter/tree-sitter-javascript/releases`);
      console.error(`- Python: https://github.com/tree-sitter/tree-sitter-python/releases`);

      // Attempt to run the setup script automatically if in a Node.js context (not in browser)
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        console.log('\nAttempting to download WASM files automatically...');

        try {
          // Using dynamic import to avoid issues in browser environments
          const setupModule = await import('./setup.js');
          if (typeof setupModule.default === 'function') {
            await setupModule.default();
          } else {
            // Try to run the setupParsers function directly
            await setupModule.setupParsers();
          }

          // Try to initialize again with the newly downloaded files
          return await initializeTreeSitter();
        } catch (setupErr) {
          console.error('Automatic download failed:', setupErr.message);
        }
      }
    }

    initialized = missingWasmFiles.length === 0;
    return initialized;
  } catch (err) {
    console.error("Failed to initialize Tree-sitter:", err);
    throw err;
  }
}

// Function to determine language from file extension
function getLanguageFromExtension(filePath) {
  const ext = path.extname(filePath).substring(1).toLowerCase();
  return SUPPORTED_LANGUAGES[ext] || null;
}

// Function to extract code symbols from a file
async function extractCodeSymbols(filePath, fileContent) {
  // Ensure TreeSitter is initialized
  if (!initialized) {
    await initializeTreeSitter();
  }

  try {
    // Set the appropriate language based on file extension
    const wasmFile = getLanguageFromExtension(filePath);
    if (!wasmFile || !languageInstances[wasmFile]) {
      return null; // Unsupported language
    }

    const parser = new Parser();
    parser.setLanguage(languageInstances[wasmFile]);
    const tree = parser.parse(fileContent);
    const rootNode = tree.rootNode;

    const functions = [];
    const variables = [];
    const classes = [];
    const imports = [];
    const exports = [];

    // Helper to get line and column info
    const getPosition = (node) => {
      return {
        startLine: node.startPosition.row + 1,
        startCol: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endCol: node.endPosition.column
      };
    };

    // Helper to check if a function is significant enough to track
    const isSignificantFunction = (node, name) => {
      // Skip tiny arrow functions like () => {} or x => x
      if (node.type === 'arrow_function' && node.text.length < 15) {
        return false;
      }

      // Skip callback functions in array methods if they're simple
      const parent = node.parent;
      if (parent &&
         (parent.type === 'call_expression' || parent.type === 'member_expression') &&
         node.text.length < 50) {
        // Check if it's a callback in common array methods
        const callText = parent.text.slice(0, 30).toLowerCase();
        if (callText.includes('.map(') ||
            callText.includes('.filter(') ||
            callText.includes('.forEach(') ||
            callText.includes('.find(') ||
            callText.includes('.reduce(')) {
          return false;
        }
      }

      // Keep named functions and significant anonymous ones
      return name !== 'anonymous' || node.text.length > 100;
    };

    // Helper to infer function name from context
    const inferFunctionName = (node) => {
      let name = 'anonymous';

      // Check if function is assigned to a variable
      const parent = node.parent;

      if (parent) {
        if (parent.type === 'variable_declarator') {
          // Case: const myFunc = function() {...} or const myFunc = () => {...}
          const nameNode = parent.childForFieldName('name');
          if (nameNode) {
            return nameNode.text;
          }
        } else if (parent.type === 'pair' && parent.parent && parent.parent.type === 'object') {
          // Case: { myMethod: function() {...} } or { myMethod: () => {...} }
          const keyNode = parent.childForFieldName('key');
          if (keyNode) {
            return keyNode.text.replace(/['"]/g, '');
          }
        } else if (parent.type === 'assignment_expression') {
          // Case: obj.method = function() {...} or MyClass.prototype.method = function() {...}
          const leftNode = parent.childForFieldName('left');
          if (leftNode) {
            if (leftNode.type === 'member_expression') {
              // Get rightmost part, e.g., 'method' from 'obj.method'
              const propertyNode = leftNode.childForFieldName('property');
              if (propertyNode) {
                return propertyNode.text;
              }
            } else {
              return leftNode.text;
            }
          }
        } else if (parent.type === 'property_identifier' && parent.parent &&
                  parent.parent.type === 'member_expression') {
          // Case for method callbacks like .then(() => {...})
          return parent.text;
        }
      }

      return name;
    };

    // Process different languages
    if (wasmFile === 'tree-sitter-javascript.wasm') {
      // Process JavaScript/TypeScript

      // Find function declarations
      const functionNodes = rootNode.descendantsOfType([
        'function_declaration',
        'method_definition',
        'arrow_function',
        'function'
      ]);

      for (const node of functionNodes) {
        // Get function name
        let name = 'anonymous';
        let parentFunction = null;

        if (node.type === 'function_declaration') {
          const nameNode = node.firstNamedChild;
          if (nameNode) name = nameNode.text;
        } else if (node.type === 'method_definition') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) name = nameNode.text;

          // Get parent class or object
          const classNode = node.parent?.parent;
          if (classNode?.type === 'class_declaration') {
            const classNameNode = classNode.childForFieldName('name');
            if (classNameNode) parentFunction = classNameNode.text;
          }
        } else if (node.type === 'function' || node.type === 'arrow_function') {
          // Try to infer the name from context
          name = inferFunctionName(node);
        }

        // Only add significant functions
        if (isSignificantFunction(node, name)) {
          functions.push({
            name,
            parent: parentFunction,
            position: getPosition(node),
            code: node.text
          });
        }
      }

      // Find variable declarations
      const variableNodes = rootNode.descendantsOfType([
        'variable_declaration',
        'lexical_declaration'
      ]);

      for (const node of variableNodes) {
        const declarators = node.descendantsOfType('variable_declarator');
        for (const declarator of declarators) {
          const nameNode = declarator.childForFieldName('name');
          if (nameNode) {
            variables.push({
              name: nameNode.text,
              kind: node.childForFieldName('kind')?.text || 'var',
              position: getPosition(declarator),
              code: declarator.text
            });
          }
        }
      }

      // Find class declarations
      const classNodes = rootNode.descendantsOfType('class_declaration');

      for (const node of classNodes) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const className = nameNode.text;

          // Get class members
          const methods = [];
          const methodNodes = node.descendantsOfType('method_definition');

          for (const methodNode of methodNodes) {
            const methodNameNode = methodNode.childForFieldName('name');
            if (methodNameNode) {
              methods.push({
                name: methodNameNode.text,
                position: getPosition(methodNode),
                isStatic: methodNode.childForFieldName('static')?.text === 'static',
                code: methodNode.text
              });
            }
          }

          classes.push({
            name: className,
            position: getPosition(node),
            methods,
            code: node.text
          });
        }
      }

      // Find imports
      const importNodes = rootNode.descendantsOfType('import_statement');

      for (const node of importNodes) {
        const sourceNode = node.childForFieldName('source');
        if (sourceNode) {
          const source = sourceNode.text.replace(/['"]/g, '');
          const importedItems = [];

          const specifiers = node.descendantsOfType([
            'import_specifier',
            'namespace_import'
          ]);

          for (const specNode of specifiers) {
            if (specNode.type === 'import_specifier') {
              const nameNode = specNode.childForFieldName('name');
              const aliasNode = specNode.childForFieldName('alias');

              if (nameNode) {
                importedItems.push({
                  name: nameNode.text,
                  alias: aliasNode ? aliasNode.text : null
                });
              }
            } else if (specNode.type === 'namespace_import') {
              const nameNode = specNode.childForFieldName('name');
              if (nameNode) {
                importedItems.push({
                  name: '*',
                  alias: nameNode.text
                });
              }
            }
          }

          // Check for default imports
          const defaultImportNode = node.descendantsOfType('identifier')[0];
          if (defaultImportNode && !specifiers.length) {
            importedItems.push({
              name: 'default',
              alias: defaultImportNode.text
            });
          }

          imports.push({
            source,
            items: importedItems,
            position: getPosition(node),
            code: node.text
          });
        }
      }

      // Find exports
      const exportNodes = rootNode.descendantsOfType([
        'export_statement',
        'lexical_declaration',
        'function_declaration'
      ]);

      for (const node of exportNodes) {
        if (node.type === 'export_statement') {
          const sourceNode = node.childForFieldName('source');
          const source = sourceNode ? sourceNode.text.replace(/['"]/g, '') : null;

          const exportedItems = [];
          const specifiers = node.descendantsOfType('export_specifier');

          for (const specNode of specifiers) {
            const nameNode = specNode.childForFieldName('name');
            const aliasNode = specNode.childForFieldName('alias');

            if (nameNode) {
              exportedItems.push({
                name: nameNode.text,
                alias: aliasNode ? aliasNode.text : null
              });
            }
          }

          exports.push({
            source,
            items: exportedItems,
            isDefault: node.childForFieldName('default')?.text === 'default',
            position: getPosition(node),
            code: node.text
          });
        } else {
          // Check for export modifier on declaration
          const parent = node.parent;
          if (parent?.type === 'export_statement') {
            let name = '';
            if (node.type === 'function_declaration') {
              const nameNode = node.childForFieldName('name');
              if (nameNode) name = nameNode.text;
            } else if (node.type === 'lexical_declaration') {
              const declarator = node.descendantsOfType('variable_declarator')[0];
              if (declarator) {
                const nameNode = declarator.childForFieldName('name');
                if (nameNode) name = nameNode.text;
              }
            }

            if (name) {
              exports.push({
                source: null,
                items: [{ name, alias: null }],
                isDefault: parent.childForFieldName('default')?.text === 'default',
                position: getPosition(parent),
                code: parent.text
              });
            }
          }
        }
      }
    } else if (wasmFile === 'tree-sitter-python.wasm') {
      // Process Python

      // Find function declarations
      const functionNodes = rootNode.descendantsOfType('function_definition');

      for (const node of functionNodes) {
        // Get function name
        let name = 'anonymous';
        let parentFunction = null;

        const nameNode = node.childForFieldName('name');
        if (nameNode) name = nameNode.text;

        // Check if this is a class method
        const parent = node.parent?.parent;
        if (parent?.type === 'class_definition') {
          const classNameNode = parent.childForFieldName('name');
          if (classNameNode) parentFunction = classNameNode.text;
        }

        functions.push({
          name,
          parent: parentFunction,
          position: getPosition(node),
          code: node.text
        });
      }

      // Find variable assignments (global and class level)
      const assignmentNodes = rootNode.descendantsOfType('assignment');

      for (const node of assignmentNodes) {
        // Only consider top-level or class-level assignments
        const parent = node.parent;
        if (parent?.type === 'module' || parent?.type === 'block' && parent.parent?.type === 'class_definition') {
          const left = node.childForFieldName('left');
          if (left && left.type === 'identifier') {
            variables.push({
              name: left.text,
              kind: 'var', // Python doesn't have explicit variable declarations
              position: getPosition(node),
              code: node.text
            });
          }
        }
      }

      // Find class declarations
      const classNodes = rootNode.descendantsOfType('class_definition');

      for (const node of classNodes) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const className = nameNode.text;

          // Get class methods
          const methods = [];
          const methodNodes = node.descendantsOfType('function_definition');

          for (const methodNode of methodNodes) {
            const methodNameNode = methodNode.childForFieldName('name');
            if (methodNameNode) {
              // Check if method is static (has @staticmethod decorator)
              let isStatic = false;
              const decorators = methodNode.childForFieldName('decorator_list');
              if (decorators) {
                const decoratorNodes = decorators.children;
                for (const decorator of decoratorNodes) {
                  if (decorator.text === '@staticmethod') {
                    isStatic = true;
                    break;
                  }
                }
              }

              methods.push({
                name: methodNameNode.text,
                position: getPosition(methodNode),
                isStatic,
                code: methodNode.text
              });
            }
          }

          classes.push({
            name: className,
            position: getPosition(node),
            methods,
            code: node.text
          });
        }
      }

      // Find imports
      const importNodes = rootNode.descendantsOfType(['import_statement', 'import_from_statement']);

      for (const node of importNodes) {
        if (node.type === 'import_statement') {
          // Case: import module [as alias]
          const namesNode = node.childForFieldName('names');
          if (namesNode) {
            const importedModules = namesNode.descendantsOfType('dotted_name');

            for (const moduleNode of importedModules) {
              const moduleName = moduleNode.text;
              const aliasNode = moduleNode.nextNamedSibling;

              imports.push({
                source: moduleName,
                items: [{
                  name: 'module',
                  alias: aliasNode ? aliasNode.text : null
                }],
                position: getPosition(node),
                code: node.text
              });
            }
          }
        } else if (node.type === 'import_from_statement') {
          // Case: from module import name [as alias], ...
          const moduleNode = node.childForFieldName('module');
          const namesNode = node.childForFieldName('names');

          if (moduleNode && namesNode) {
            const moduleName = moduleNode.text;
            const importedItems = [];

            const importedNames = namesNode.namedChildren;
            for (const nameNode of importedNames) {
              if (nameNode.type === 'aliased_import') {
                const name = nameNode.childForFieldName('name')?.text;
                const alias = nameNode.childForFieldName('alias')?.text;

                if (name) {
                  importedItems.push({
                    name,
                    alias
                  });
                }
              } else if (nameNode.type === 'identifier') {
                importedItems.push({
                  name: nameNode.text,
                  alias: null
                });
              }
            }

            imports.push({
              source: moduleName,
              items: importedItems,
              position: getPosition(node),
              code: node.text
            });
          }
        }
      }
    }

    return {
      functions,
      variables,
      classes,
      imports,
      exports
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}: ${error.message}`);
    return null;
  }
}

// Function to parse .gitignore file
function parseGitignore(gitignorePath) {
  if (!fs.existsSync(gitignorePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(pattern => {
        // Common patterns we want to handle explicitly
        if (pattern === 'node_modules' || pattern === 'node_modules/') {
          return '^node_modules($|/)';
        }

        // Remove trailing slashes (they mean directories in gitignore)
        let processedPattern = pattern.replace(/\/+$/, '');

        // Handle leading slashes (anchors the pattern to the root)
        const hasLeadingSlash = processedPattern.startsWith('/');
        if (hasLeadingSlash) {
          processedPattern = processedPattern.slice(1);
        }

        // Convert gitignore glob pattern to regex pattern
        processedPattern = processedPattern
          .replace(/\./g, '\\.') // Escape dots
          .replace(/\*\*/g, '__DOUBLE_STAR__') // Temporarily replace **
          .replace(/\*/g, '[^/]*') // * matches any character except /
          .replace(/__DOUBLE_STAR__/g, '.*') // ** matches anything including /
          .replace(/\?/g, '[^/]') // ? matches a single character except /
          .replace(/\//g, '\\/'); // Escape forward slashes

        // If it had a leading slash, anchor it to the start
        if (hasLeadingSlash) {
          return `^${processedPattern}($|/.*)`;
        }

        // If no leading slash, match anywhere in path
        return `(^|.*/|^/)${processedPattern}($|/.*)`;
      });
  } catch (error) {
    console.error(`Error parsing .gitignore: ${error.message}`);
    return [];
  }
}

// Function to check if a path should be ignored based on gitignore patterns
function shouldIgnore(itemPath, ignorePatterns, rootPath) {
  if (ignorePatterns.length === 0) {
    return false;
  }

  // Get relative path for matching (always use forward slashes)
  const relativePath = path.relative(rootPath, itemPath).replace(/\\/g, '/');

  // Add trailing slash for directories to match directory-specific patterns
  const stats = fs.statSync(itemPath);
  const pathToCheck = stats.isDirectory() ? `${relativePath}/` : relativePath;

  // Name-only check for simple file matches
  const itemName = path.basename(itemPath);

  // Check if the path matches any ignore pattern
  return ignorePatterns.some(pattern => {
    const regex = new RegExp(pattern);
    return regex.test(pathToCheck) || regex.test(itemName);
  });
}

// Function to check if file is supported for code analysis
function isSupportedFile(filePath, customPatterns = null) {
  // If we have custom patterns, check if the file matches any of them
  if (customPatterns && customPatterns.length > 0) {
    const fileName = path.basename(filePath);
    return customPatterns.some(pattern => {
      // Try to match as glob pattern
      if (pattern.includes('*')) {
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*');
        return new RegExp(`^${regexPattern}$`).test(fileName);
      }
      // Check for extension match (with or without the dot)
      if (pattern.startsWith('.')) {
        return filePath.endsWith(pattern);
      }
      // Match by extension without the dot
      return path.extname(filePath).substring(1).toLowerCase() === pattern.toLowerCase();
    });
  }

  // Otherwise use the default language support check
  const ext = path.extname(filePath).substring(1).toLowerCase();
  return ext in SUPPORTED_LANGUAGES;
}

// Create parsers directory if it doesn't exist
function ensureParsersDirectory() {
  const parsersDir = path.join(__dirname, 'parsers');
  if (!fs.existsSync(parsersDir)) {
    fs.mkdirSync(parsersDir, { recursive: true });
  }
  return parsersDir;
}

// Function to recursively get directory structure and analyze JS files
async function getDirectoryTree(dirPath, rootPath = dirPath, ignorePatterns = [], filePatterns = null, indent = '', analyzeJs = false, includeSymbols = false, symbolType = 'all', currentDepth = 0, maxDepth = 5) {
  try {
    if (!fs.existsSync(dirPath)) {
      return `${indent}Path does not exist: ${dirPath}`;
    }

    // Default patterns to ignore common directories and files
    const defaultIgnorePatterns = [
      '^node_modules($|/)',
      '^.git($|/)',
      '\\.log$',
      '\\.tmp$',
      '\\.temp$',
      '\\.swp$',
      '\\.DS_Store$',
      '\\.vscode($|/)',
      '\\.idea($|/)',
      '\\.vs($|/)',
      '^dist($|/)',
      '^build($|/)',
      '^coverage($|/)'
    ];

    // Combine default patterns with any provided patterns
    let allIgnorePatterns = [...defaultIgnorePatterns, ...ignorePatterns];

    // Check for .gitignore file in this directory
    const gitignorePath = path.join(dirPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const newPatterns = parseGitignore(gitignorePath);
      allIgnorePatterns = [...allIgnorePatterns, ...newPatterns];
    }

    let output = '';
    const items = fs.readdirSync(dirPath);

    for (let i = 0; i < items.length; i++) {
      const itemName = items[i];
      const itemPath = path.join(dirPath, itemName);

      // Skip .gitignore files
      if (itemName === '.gitignore') {
        continue;
      }

      // Skip hidden files/directories
      if (itemName.startsWith('.')) {
        continue;
      }

      // Skip items that match ignore patterns
      if (shouldIgnore(itemPath, allIgnorePatterns, rootPath)) {
        continue;
      }

      const isLast = i === items.length - 1;
      const stats = fs.statSync(itemPath);

      // Generate the prefix for current item
      const prefix = isLast ? '└── ' : '├── ';

      // Generate the prefix for child items
      const childIndent = indent + (isLast ? '    ' : '│   ');

      if (stats.isDirectory()) {
        output += `${indent}${prefix}${itemName}/\n`;

        // Always recurse to build the directory tree, but only analyze code if we're within maxDepth
        const shouldAnalyze = analyzeJs && (currentDepth < maxDepth);

        output += await getDirectoryTree(
          itemPath,
          rootPath,
          allIgnorePatterns,
          filePatterns,
          childIndent,
          shouldAnalyze, // Only analyze if within depth limit
          includeSymbols,
          symbolType,
          currentDepth + 1,
          maxDepth
        );
      } else {
        const sizeInKB = Math.ceil(stats.size / 1024);
        output += `${indent}${prefix}${itemName} (${sizeInKB} KB)\n`;

        // Analyze supported files if requested AND we're within the max depth limit
        if (analyzeJs && currentDepth <= maxDepth && isSupportedFile(itemPath, filePatterns)) {
          try {
            const fileContent = fs.readFileSync(itemPath, 'utf8');
            const symbols = await extractCodeSymbols(itemPath, fileContent);

            if (symbols) {
              // Store the extracted symbols
              codeSymbols.functions[itemPath] = symbols.functions;
              codeSymbols.variables[itemPath] = symbols.variables;
              codeSymbols.classes[itemPath] = symbols.classes;
              codeSymbols.imports[itemPath] = symbols.imports;
              codeSymbols.exports[itemPath] = symbols.exports;
              codeSymbols.files.add(itemPath);

              // Add a summary of what was found
              output += `${childIndent}└── [Analyzed: ${symbols.functions.length} functions, ${symbols.variables.length} variables, ${symbols.classes.length} classes]\n`;

              // Add detailed symbol information if requested
              if (includeSymbols) {
                // Functions
                if ((symbolType === 'functions' || symbolType === 'all') && symbols.functions.length > 0) {
                  // Always filter out anonymous functions by default
                  const fileFunctions = symbols.functions.filter(fn => fn.name !== 'anonymous');

                  if (fileFunctions.length > 0) {
                    output += `${childIndent}    Functions:\n`;
                    output += fileFunctions.map(fn =>
                      `${childIndent}    - ${fn.name}${fn.parent ? ` (in ${fn.parent})` : ''} [${fn.position.startLine}:${fn.position.startCol}]`
                    ).join('\n') + '\n';
                  }
                }

                // Variables
                if ((symbolType === 'variables' || symbolType === 'all') && symbols.variables.length > 0) {
                  output += `${childIndent}    Variables:\n`;
                  output += symbols.variables.map(v =>
                    `${childIndent}    - ${v.kind} ${v.name} [${v.position.startLine}:${v.position.startCol}]`
                  ).join('\n') + '\n';
                }

                // Classes
                if ((symbolType === 'classes' || symbolType === 'all') && symbols.classes.length > 0) {
                  output += `${childIndent}    Classes:\n`;
                  output += symbols.classes.map(c => {
                    let classInfo = `${childIndent}    - ${c.name} [${c.position.startLine}:${c.position.startCol}]`;
                    if (c.methods.length > 0) {
                      classInfo += `\n${childIndent}      Methods:\n`;
                      classInfo += c.methods.map(m =>
                        `${childIndent}      - ${m.isStatic ? 'static ' : ''}${m.name} [${m.position.startLine}:${m.position.startCol}]`
                      ).join('\n');
                    }
                    return classInfo;
                  }).join('\n') + '\n';
                }

                // Imports
                if ((symbolType === 'imports' || symbolType === 'all') && symbols.imports.length > 0) {
                  output += `${childIndent}    Imports:\n`;
                  output += symbols.imports.map(imp => {
                    let importInfo = `${childIndent}    - from '${imp.source}'`;
                    if (imp.items.length > 0) {
                      importInfo += ': ' + imp.items.map(item =>
                        `${item.name}${item.alias ? ` as ${item.alias}` : ''}`
                      ).join(', ');
                    }
                    return importInfo;
                  }).join('\n') + '\n';
                }

                // Exports
                if ((symbolType === 'exports' || symbolType === 'all') && symbols.exports.length > 0) {
                  output += `${childIndent}    Exports:\n`;
                  output += symbols.exports.map(exp => {
                    let exportInfo = `${childIndent}    - ${exp.isDefault ? 'default export' : 'export'}`;
                    if (exp.source) {
                      exportInfo += ` from '${exp.source}'`;
                    }
                    if (exp.items.length > 0) {
                      exportInfo += ': ' + exp.items.map(item =>
                        `${item.name}${item.alias ? ` as ${item.alias}` : ''}`
                      ).join(', ');
                    }
                    return exportInfo;
                  }).join('\n') + '\n';
                }
              }
            }
          } catch (error) {
            console.error(`Error analyzing ${itemPath}: ${error.message}`);
          }
        }
      }
    }

    return output;
  } catch (error) {
    console.error(`Error processing directory ${dirPath}: ${error.message}`);
    return `${indent}Error: ${error.message}\n`;
  }
}

// Create an MCP Server
const server = new McpServer({
  name: "Context Provider MCP Server",
  version: "1.0.0"
});

// Add the get_code_context tool
server.tool(
  "get_code_context",
  "Returns Complete Context of a given project directory, including directory tree, and code symbols. Useful for getting a quick overview of a project. Use this tool when you need to get a comprehensive overview of a project's codebase. Useful at the start of a new task.",
  {
    absolutePath: z.string().describe("Absolute path to the directory to analyze. For windows, it is recommended to use forward slashes to avoid escaping (e.g. C:/Users/username/Documents/project/src)"),
    analyzeJs: z.boolean().optional().default(false).describe("Whether to analyze JavaScript/TypeScript and Python files. Returns the count of functions, variables, classes, imports, and exports in the codebase."),
    includeSymbols: z.boolean().optional().default(false).describe("Whether to include code symbols in the response. Returns the code symbols for each file."),
    symbolType: z.enum(['functions', 'variables', 'classes', 'imports', 'exports', 'all']).optional().default('all').describe("Type of symbols to include if includeSymbols is true. Otherwise, returns only the directory tree."),
    maxDepth: z.number().optional().default(5).describe("Maximum directory depth for code analysis (default: 5 levels). Directory tree will still be built for all levels. Reduce the depth if you only need a quick overview of the project.")
  },
  async ({ absolutePath, analyzeJs, includeSymbols, symbolType, filePatterns, maxDepth = 5 }) => {
    try {
      // Check if the path is C:/ drive on Windows OS
      if (process.platform === 'win32' && /^[cC]:[\\/]/.test(absolutePath)) {
        return {
          content: [{ type: "text", text: "C drive is not a project directory. Try different path" }],
          isError: true
        };
      }

      // Ensure TreeSitter is initialized if we're going to analyze code
      if (analyzeJs && !initialized) {
        // Create parsers directory and ensure it exists
        const parsersDir = ensureParsersDirectory();
        console.error(`Using parsers directory: ${parsersDir}`);

        // Initialize TreeSitter
        await initializeTreeSitter();

        if (!initialized) {
          return {
            content: [{ type: "text", text: "Error: Failed to initialize code analysis parser. WASM parsers may be missing." }],
            isError: true
          };
        }
      }

      // Normalize path to handle both Windows and Unix-style paths
      const normalizedPath = path.normalize(absolutePath);
      console.error(`Analyzing directory: ${normalizedPath} (analyzeJs: ${analyzeJs}, maxAnalysisDepth: ${maxDepth !== 5 ? maxDepth : '5 (default)'})`);

      // Reset code symbols if analyzing JS
      if (analyzeJs) {
        codeSymbols.functions = {};
        codeSymbols.variables = {};
        codeSymbols.classes = {};
        codeSymbols.imports = {};
        codeSymbols.exports = {};
        codeSymbols.files = new Set();
      }

      // Get the directory tree, passing along all the symbol-related parameters
      const tree = await getDirectoryTree(
        normalizedPath,
        normalizedPath,
        [],
        filePatterns,
        '',
        analyzeJs,
        includeSymbols,
        symbolType,
        0,
        maxDepth
      );

      // Generate summary of analyzed files if applicable
      let analysisSummary = '';
      if (analyzeJs && codeSymbols.files.size > 0) {
        const totalFunctions = Object.values(codeSymbols.functions).reduce((sum, arr) => sum + arr.length, 0);
        const totalVariables = Object.values(codeSymbols.variables).reduce((sum, arr) => sum + arr.length, 0);
        const totalClasses = Object.values(codeSymbols.classes).reduce((sum, arr) => sum + arr.length, 0);

        analysisSummary = `\n\nCode Analysis Summary:
- Files analyzed: ${codeSymbols.files.size}
- Total functions: ${totalFunctions}
- Total variables: ${totalVariables}
- Total classes: ${totalClasses}`;

        // Add language support info and custom pattern info
        if (filePatterns && filePatterns.length > 0) {
          analysisSummary += `\n\nAnalyzed files matching patterns: ${filePatterns.join(', ')}`;
        } else {
          analysisSummary += `\n\nNote: Symbol analysis is supported for JavaScript/TypeScript (.js, .jsx, .ts, .tsx) and Python (.py) files only.`;
        }

        // Add depth limit info if applicable
        if (maxDepth !== 5) {
          analysisSummary += `\n\nCode analysis limited to a maximum depth of ${maxDepth} directory levels.`;
        } else {
          analysisSummary += `\n\nCode analysis limited to a maximum depth of 5 directory levels (default).`;
        }
      }

      // Return the result
      return {
        content: [
          {
            type: "text",
            text: `Directory structure for: ${normalizedPath}${analysisSummary}\n\n${tree}`
          }
        ]
      };
    } catch (error) {
      console.error(`Error in get_code_context tool: ${error.message}`);
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// Add a simple prompt template
server.prompt(
  "hello",
  { name: z.string() },
  ({ name }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Hello ${name}, how can I assist you today?`
      }
    }]
  })
);

// Create a transport that communicates over stdin/stdout
const transport = new StdioServerTransport();

// Connect the server to the transport
console.error('Starting MCP Server over stdio...');
server.connect(transport).catch(err => {
  console.error('Error connecting server:', err);
  process.exit(1);
});
