// Generated code is bundled against these in-memory CommonJS modules. Keep
// this map shared by the browser and headless compilers so recovery builds use
// exactly the same import semantics as builds compiled in the console.
//
// Devin is instructed to use `import * as Runtime`, but generated code may
// occasionally use the equivalent-looking `import { Runtime }`. The aliases
// below make both forms safe without changing the frozen runtime globals.
export const COMPILER_SHIMS: Readonly<Record<string, string>> = Object.freeze({
  react: "module.exports = window.React;",
  "react-dom": "module.exports = window.ReactDOM || {};",
  "react/jsx-runtime":
    "const R=window.React; exports.jsx=(t,p,k)=>R.createElement(t,k===undefined?p:{...p,key:k}); exports.jsxs=exports.jsx; exports.Fragment=R.Fragment;",
  "@runtime/sdk":
    "const R=window.Runtime; module.exports={...R,Runtime:R};",
  "@runtime/ui":
    "const UI=window.RuntimeUI; module.exports={...UI,RuntimeUI:UI};",
});
