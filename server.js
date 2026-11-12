// server.js — MCP-style tool server + JSON-RPC-style dispatcher.
//
// The dispatcher speaks a small JSON-RPC-style protocol an LLM client could
// call, in the same shape as MCP's tools/list and tools/call:
//   {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
//   {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_logs","arguments":{"service":"checkout-api"}}}
// It runs as a CLI for demo purposes: `node server.js --list` or
// `node server.js --call get_logs --args '{"service":"checkout-api"}'`.
// A real MCP deployment would wrap this same registry in the MCP SDK's
// transport (stdio/SSE); the tools and schemas are already in MCP shape.

const { listTools, callTool } = require('./tools');

function dispatch(request) {
  const { jsonrpc, id, method, params } = request || {};
  if (jsonrpc !== '2.0' || !method) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid request: expected {jsonrpc:"2.0", id, method, params}.' } };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: listTools() } };
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    if (!name) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call requires params.name.' } };
    }
    const out = callTool(name, args || {});
    if (!out.ok) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: out.error } };
    }
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out.result, null, 2) }] } };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}.` } };
}

function printHelp() {
  console.log('Usage:');
  console.log('  node server.js --list');
  console.log('  node server.js --call <tool-name> --args \'{...json...}\'');
  console.log('  echo \'{...json-rpc...}\' | node server.js   (stdin JSON-RPC request)');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  if (args.includes('--list')) {
    console.log(JSON.stringify(dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), null, 2));
    process.exit(0);
  }
  const callIdx = args.indexOf('--call');
  if (callIdx !== -1) {
    const name = args[callIdx + 1];
    const argsIdx = args.indexOf('--args');
    let parsed = {};
    if (argsIdx !== -1) {
      try {
        parsed = JSON.parse(args[argsIdx + 1]);
      } catch {
        console.error('Error: --args must be valid JSON.');
        process.exit(1);
      }
    }
    console.log(JSON.stringify(dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: parsed } }), null, 2));
    process.exit(0);
  }
  // Otherwise read a single JSON-RPC request from stdin.
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    let req;
    try {
      req = JSON.parse(data);
    } catch {
      console.error('Error: stdin must contain a single JSON-RPC request object.');
      process.exit(1);
    }
    console.log(JSON.stringify(dispatch(req), null, 2));
  });
  if (process.stdin.isTTY) printHelp();
}

module.exports = { dispatch };
