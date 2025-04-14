#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import * as url from 'url';
import https from 'https';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

// Direct URLs to WASM files
const PARSERS = [
  {
    name: 'tree-sitter-javascript.wasm',
    url: 'https://tree-sitter.github.io/tree-sitter-javascript.wasm'
  },
  {
    name: 'tree-sitter-python.wasm',
    url: 'https://tree-sitter.github.io/tree-sitter-python.wasm'
  }
];

// Create parsers directory if it doesn't exist
function ensureParsersDirectory() {
  const parsersDir = path.join(__dirname, 'parsers');
  if (!fs.existsSync(parsersDir)) {
    console.log(`Creating parsers directory at ${parsersDir}`);
    fs.mkdirSync(parsersDir, { recursive: true });
  }
  return parsersDir;
}

// Download a file from URL with redirect support
function downloadFile(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    console.log(`Downloading ${url}`);
    
    const request = https.get(url, (response) => {
      // Handle redirects (status codes 301, 302, 307, 308)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`Redirecting to ${response.headers.location}`);
        downloadFile(response.headers.location, destination, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download, status code: ${response.statusCode}`));
        return;
      }
      
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded to ${destination}`);
        resolve();
      });
      
      file.on('error', (err) => {
        fs.unlink(destination, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
    
    request.end();
  });
}

// Main function to download all parsers
async function setupParsers() {
  try {
    const parsersDir = ensureParsersDirectory();
    
    console.log('Setting up Tree-sitter WASM parsers...');
    
    // Check if we're running in an npm lifecycle event
    const isNpmInstall = process.env.npm_lifecycle_event === 'install' || 
                         process.env.npm_lifecycle_event === 'prepare' ||
                         process.env.npm_lifecycle_event === 'postinstall';
    
    // Determine if we're running in npm publish
    const isNpmPublish = process.env.npm_lifecycle_event === 'prepublishOnly';
    
    if (isNpmPublish) {
      console.log('Running as part of npm publish, ensuring WASM files are properly handled...');
    }
    
    // Track download failures
    let failures = 0;
    let success = 0;
    
    for (const parser of PARSERS) {
      const destination = path.join(parsersDir, parser.name);
      
      // Skip if the parser already exists
      if (fs.existsSync(destination)) {
        console.log(`Parser ${parser.name} already exists, skipping download`);
        success++;
        continue;
      }
      
      try {
        await downloadFile(parser.url, destination);
        success++;
      } catch (err) {
        console.error(`Error downloading ${parser.name}: ${err.message}`);
        console.error('You may need to download this file manually.');
        console.error(`Place it in: ${parsersDir}`);
        failures++;
      }
    }
    
    if (success === PARSERS.length) {
      console.log('\nSetup complete! All required WASM parsers have been downloaded.');
    } else {
      console.log(`\nSetup completed with ${failures} failures and ${success} successes.`);
      if (failures > 0) {
        console.log("\nManual download instructions:");
        console.log("1. Create a 'parsers' directory in your project or global installation");
        console.log("2. Download the WASM files from these sources:");
        console.log("   - JavaScript: https://github.com/tree-sitter/tree-sitter-javascript/releases");
        console.log("   - Python: https://github.com/tree-sitter/tree-sitter-python/releases");
        console.log(`3. Place them in the parsers directory: ${parsersDir}`);
      }
    }
    
    console.log(`\nParsers are located at: ${parsersDir}`);
    
    // If we're in npm install or prepare, provide additional guidance
    if (isNpmInstall) {
      console.log('\nThis setup was triggered by npm installation.');
      console.log('If you encounter any issues, run the setup manually:');
      console.log('  npx code-context-provider-mcp-setup');
    }
    
    return { success, failures, parsersDir };
  } catch (err) {
    console.error('Error during setup:', err);
    process.exit(1);
  }
}

// Run the setup if this script is executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1] && 
    import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  setupParsers();
}

// Export the setup function for programmatic use
export { setupParsers };
export default setupParsers; 