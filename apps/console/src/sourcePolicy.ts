import ts from "typescript";

const MAX_SOURCE_LENGTH = 120_000;
const ALLOWED_IMPORTS = new Set(["react", "@runtime/sdk", "@runtime/ui"]);
type ConnectorId = "convex" | "context" | "openai" | "vercel";
const REALTIME_RUNTIME_APIS = new Set([
  "useDoc",
  "useDocs",
  "useList",
  "useLeaderboard",
  "usePresence",
  "useTimer",
  "useRt",
]);
const OPENAI_RUNTIME_APIS = new Set(["useAI"]);
// These globals are unnecessary for a generated audience app and would let it
// bypass the fixed Runtime surface. The CSP in the shell is the second layer.
const FORBIDDEN_GLOBALS = new Set([
  "window",
  "document",
  "globalThis",
  "self",
  "top",
  "parent",
  "frames",
  "location",
  "history",
  "navigation",
  "opener",
  "Reflect",
  "Proxy",
  "Image",
  "Audio",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "postMessage",
  "eval",
  "Function",
  "require",
  "module",
  "exports",
  "open",
  "close",
]);

const FORBIDDEN_PROPERTIES = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "ownerDocument",
  "defaultView",
  "contentWindow",
  "contentDocument",
  "srcdoc",
  "dangerouslySetInnerHTML",
  "nativeEvent",
  "parentNode",
  "ownerElement",
  "getRootNode",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "__lookupGetter__",
  "__lookupSetter__",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
]);

const FORBIDDEN_JSX_ELEMENTS = new Set([
  "a",
  "base",
  "embed",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
]);

function lineAndColumn(sourceFile: ts.SourceFile, node: ts.Node): string {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${pos.line + 1}:${pos.character + 1}`;
}

function fail(sourceFile: ts.SourceFile, node: ts.Node, message: string): never {
  throw new Error(`Generated source policy: ${message} (${lineAndColumn(sourceFile, node)})`);
}

function isNonLexicalName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    (ts.isImportSpecifier(parent) && parent.propertyName === node) ||
    (ts.isExportSpecifier(parent) && parent.propertyName === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    ((ts.isJsxOpeningElement(parent) ||
      ts.isJsxClosingElement(parent) ||
      ts.isJsxSelfClosingElement(parent)) &&
      parent.tagName === node)
  );
}

function isValueReference(node: ts.Identifier): boolean {
  const isNamedNodeName = (node.parent as ts.NamedDeclaration).name === node;
  return (
    (ts.isExpression(node) && !isNamedNodeName && !isNonLexicalName(node)) ||
    (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node)
  );
}

function isAmbientDeclaration(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      ts.canHaveModifiers(current) &&
      ts.getModifiers(current)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    ) {
      return true;
    }
  }
  return false;
}

type RuntimeBindings = Map<ts.Node, Set<string>>;

function addRuntimeBinding(bindings: RuntimeBindings, scope: ts.Node, name: string): void {
  const names = bindings.get(scope) ?? new Set<string>();
  names.add(name);
  bindings.set(scope, names);
}

function addBindingName(bindings: RuntimeBindings, scope: ts.Node, name: ts.BindingName): void {
  if (ts.isIdentifier(name)) {
    addRuntimeBinding(bindings, scope, name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBindingName(bindings, scope, element.name);
  }
}

function nearestRuntimeScope(node: ts.Node, blockScoped: boolean): ts.Node {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isSourceFile(current)) return current;
    if (blockScoped) {
      if (
        ts.isBlock(current) ||
        ts.isCaseBlock(current) ||
        ts.isModuleBlock(current) ||
        ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current) ||
        ts.isCatchClause(current)
      ) {
        return current;
      }
    } else if (ts.isFunctionLike(current)) {
      return current;
    }
  }
  return node.getSourceFile();
}

function collectRuntimeBindings(sourceFile: ts.SourceFile): RuntimeBindings {
  const bindings: RuntimeBindings = new Map();
  const visit = (node: ts.Node): void => {
    if (!isAmbientDeclaration(node)) {
      if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
        const blockScoped = (node.parent.flags & ts.NodeFlags.BlockScoped) !== 0;
        addBindingName(bindings, nearestRuntimeScope(node.parent, blockScoped), node.name);
      } else if (ts.isParameter(node) && ts.isFunctionLike(node.parent)) {
        addBindingName(bindings, node.parent, node.name);
      } else if (ts.isCatchClause(node) && node.variableDeclaration) {
        addBindingName(bindings, node, node.variableDeclaration.name);
      } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        addRuntimeBinding(bindings, nearestRuntimeScope(node, true), node.name.text);
      } else if (ts.isClassDeclaration(node) && node.name) {
        addRuntimeBinding(bindings, nearestRuntimeScope(node, true), node.name.text);
      } else if (ts.isEnumDeclaration(node)) {
        addRuntimeBinding(bindings, nearestRuntimeScope(node, true), node.name.text);
      } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
        addRuntimeBinding(bindings, nearestRuntimeScope(node, true), node.name.text);
      } else if (ts.isFunctionExpression(node) && node.name) {
        addRuntimeBinding(bindings, node, node.name.text);
      } else if (ts.isClassExpression(node) && node.name) {
        addRuntimeBinding(bindings, node, node.name.text);
      } else if (ts.isImportDeclaration(node) && node.importClause) {
        const clause = node.importClause;
        if (!clause.isTypeOnly && clause.name) {
          addRuntimeBinding(bindings, sourceFile, clause.name.text);
        }
        const imports = clause.namedBindings;
        if (!clause.isTypeOnly && imports && ts.isNamespaceImport(imports)) {
          addRuntimeBinding(bindings, sourceFile, imports.name.text);
        }
        if (!clause.isTypeOnly && imports && ts.isNamedImports(imports)) {
          for (const element of imports.elements) {
            if (!element.isTypeOnly) addRuntimeBinding(bindings, sourceFile, element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function hasRuntimeBinding(node: ts.Identifier, bindings: RuntimeBindings): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (bindings.get(current)?.has(node.text)) return true;
  }
  return false;
}

/** Parse and enforce the code capabilities promised by DEVIN_SYSTEM.md. */
export function validateGeneratedSource(
  source: string,
  connectors: readonly ConnectorId[] = ["convex"],
): void {
  if (!source.trim()) throw new Error("Generated source policy: source is empty");
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new Error(`Generated source policy: source exceeds ${MAX_SOURCE_LENGTH} characters`);
  }

  const sourceFile = ts.createSourceFile(
    "generated-app.tsx",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const first = diagnostics[0]!;
    const start = first.start ?? 0;
    const pos = sourceFile.getLineAndCharacterOfPosition(start);
    const message = ts.flattenDiagnosticMessageText(first.messageText, " ");
    throw new Error(`Generated TSX parse error: ${message} (${pos.line + 1}:${pos.character + 1})`);
  }

  // Resolve lexical bindings from syntax so production browser bundling cannot
  // change whether a harmless local `open`/`close` is treated as a global.
  const runtimeBindings = collectRuntimeBindings(sourceFile);

  const runtimeNamespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@runtime/sdk" ||
      !statement.importClause
    ) {
      continue;
    }
    if (statement.importClause.name) runtimeNamespaces.add(statement.importClause.name.text);
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) runtimeNamespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (imported === "default" || imported === "Runtime") {
          runtimeNamespaces.add(element.name.text);
        }
      }
    }
  }

  const runtimeCapabilitiesRestricted =
    !connectors.includes("convex") || !connectors.includes("openai");
  const isRuntimeImportBinding = (node: ts.Identifier): boolean =>
    (ts.isImportClause(node.parent) && node.parent.name === node) ||
    (ts.isNamespaceImport(node.parent) && node.parent.name === node) ||
    (ts.isImportSpecifier(node.parent) &&
      (node.parent.name === node || node.parent.propertyName === node));
  const isDirectRuntimeMemberBase = (node: ts.Identifier): boolean =>
    (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) ||
    (ts.isQualifiedName(node.parent) && node.parent.left === node) ||
    (ts.isTypeQueryNode(node.parent) && node.parent.exprName === node);

  let defaultExports = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isImportEqualsDeclaration(node)) {
      fail(sourceFile, node, "TypeScript import-equals declarations are not allowed");
    }

    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier) || !ALLOWED_IMPORTS.has(specifier.text)) {
        fail(sourceFile, node, `import ${specifier.getText(sourceFile)} is not allowed`);
      }
      if (ts.isStringLiteral(specifier) && specifier.text === "@runtime/sdk" && node.importClause) {
        const bindings = node.importClause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text;
            if (!connectors.includes("convex") && REALTIME_RUNTIME_APIS.has(imported)) {
              fail(sourceFile, element, `${imported} requires the Convex connector`);
            }
            if (!connectors.includes("openai") && OPENAI_RUNTIME_APIS.has(imported)) {
              fail(sourceFile, element, `${imported} requires the OpenAI connector`);
            }
          }
        }
      }
    }

    if (node.kind === ts.SyntaxKind.ImportKeyword) {
      fail(sourceFile, node, "dynamic import is not allowed");
    }

    if (ts.isExportAssignment(node)) defaultExports += 1;
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      defaultExports += 1;
    }

    if (
      ts.isIdentifier(node) &&
      FORBIDDEN_GLOBALS.has(node.text) &&
      isValueReference(node) &&
      !hasRuntimeBinding(node, runtimeBindings)
    ) {
      fail(sourceFile, node, `${node.text} is not available to generated apps`);
    }
    if (
      runtimeCapabilitiesRestricted &&
      ts.isIdentifier(node) &&
      runtimeNamespaces.has(node.text) &&
      !isRuntimeImportBinding(node) &&
      !isDirectRuntimeMemberBase(node)
    ) {
      fail(
        sourceFile,
        node,
        "Runtime namespace aliases and destructuring are not allowed when connector capabilities are restricted; call Runtime APIs directly",
      );
    }

    if (ts.isBindingElement(node)) {
      const name = node.propertyName ?? node.name;
      if ((ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && FORBIDDEN_PROPERTIES.has(name.text)) {
        fail(sourceFile, name, `property ${name.text} is not allowed`);
      }
    }
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = node.name;
      if ((ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && FORBIDDEN_PROPERTIES.has(name.text)) {
        fail(sourceFile, name, `property ${name.text} is not allowed`);
      }
    }

    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_PROPERTIES.has(node.name.text)) {
      fail(sourceFile, node.name, `property ${node.name.text} is not allowed`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      runtimeNamespaces.has(node.expression.text)
    ) {
      if (!connectors.includes("convex") && REALTIME_RUNTIME_APIS.has(node.name.text)) {
        fail(sourceFile, node.name, `${node.name.text} requires the Convex connector`);
      }
      if (!connectors.includes("openai") && OPENAI_RUNTIME_APIS.has(node.name.text)) {
        fail(sourceFile, node.name, `${node.name.text} requires the OpenAI connector`);
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      const numericLiteral =
        ts.isNumericLiteral(argument) ||
        (ts.isPrefixUnaryExpression(argument) &&
          (argument.operator === ts.SyntaxKind.MinusToken ||
            argument.operator === ts.SyntaxKind.PlusToken) &&
          ts.isNumericLiteral(argument.operand));
      if (!numericLiteral) {
        fail(
          sourceFile,
          argument,
          "computed property access is not allowed; use array.at(index) or named properties",
        );
      }
    }
    if (ts.isJsxAttribute(node)) {
      const attributeName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile);
      if (
        attributeName === "ref" ||
        attributeName === "dangerouslySetInnerHTML" ||
        attributeName === "href" ||
        attributeName === "target" ||
        attributeName === "action" ||
        attributeName === "formAction"
      ) {
        fail(sourceFile, node, `JSX ${attributeName} is not allowed`);
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile).toLowerCase();
      if (FORBIDDEN_JSX_ELEMENTS.has(tagName)) {
        fail(sourceFile, node.tagName, `JSX element ${tagName} is not allowed`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (defaultExports !== 1) {
    throw new Error("Generated source policy: app must have exactly one default export");
  }
}
