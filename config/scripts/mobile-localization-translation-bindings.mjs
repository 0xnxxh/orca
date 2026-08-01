// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

const MOBILE_I18N_MODULE_RE = /(?:^|\/)mobile-i18n$/

function bindingNames(name, names = []) {
  if (!name) {
    return names
  }
  if (ts.isIdentifier(name)) {
    names.push(name.text)
  } else {
    for (const element of name.elements) {
      bindingNames(element.name, names)
    }
  }
  return names
}

function isLexicalScope(node) {
  return (
    ts.isSourceFile(node) ||
    ts.isFunctionLike(node) ||
    ts.isBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  )
}

function nearestScope(node, sourceFile, predicate = isLexicalScope) {
  let current = node.parent
  while (current && current !== sourceFile) {
    if (predicate(current)) {
      return current
    }
    current = current.parent
  }
  return sourceFile
}

function functionScope(node, sourceFile) {
  return nearestScope(node, sourceFile, ts.isFunctionLike)
}

function collectDeclarations(sourceFile) {
  const declarations = new Map()

  function add(scope, name, declaration) {
    const byName = declarations.get(scope) ?? new Map()
    const matches = byName.get(name) ?? []
    matches.push(declaration)
    byName.set(name, matches)
    declarations.set(scope, byName)
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (clause?.name) {
        add(sourceFile, clause.name.text, clause.name)
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        add(sourceFile, clause.namedBindings.name.text, clause.namedBindings)
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          add(sourceFile, element.name.text, element)
        }
      }
    } else if (ts.isParameter(node)) {
      for (const name of bindingNames(node.name)) {
        add(node.parent, name, node)
      }
    } else if (ts.isVariableDeclaration(node)) {
      const declarationList = node.parent
      const scope =
        ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.BlockScoped) === 0
          ? functionScope(node, sourceFile)
          : nearestScope(node, sourceFile)
      for (const name of bindingNames(node.name)) {
        add(scope, name, node)
      }
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      add(nearestScope(node, sourceFile), node.name.text, node)
    } else if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
      add(node, node.name.text, node)
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      for (const name of bindingNames(node.variableDeclaration.name)) {
        add(node, name, node.variableDeclaration)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return declarations
}

function resolveBinding(identifier, sourceFile, declarations) {
  let current = identifier.parent
  while (current) {
    const matches = declarations.get(current)?.get(identifier.text)
    if (matches?.length) {
      return matches[0]
    }
    if (current === sourceFile) {
      break
    }
    current = current.parent
  }
  return undefined
}

function resolvesTo(identifier, bindings) {
  return bindings.resolveBinding(identifier)
}

function isNamespaceMember(node, memberName, bindings) {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === memberName &&
    ts.isIdentifier(node.expression) &&
    bindings.namespaceBindings.has(resolvesTo(node.expression, bindings))
  )
}

function isMobileI18nInstance(node, bindings) {
  if (ts.isIdentifier(node)) {
    return bindings.instanceBindings.has(resolvesTo(node, bindings))
  }
  return isNamespaceMember(node, 'mobileI18n', bindings)
}

function isEnglishFixedTranslator(node, bindings) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    isMobileI18nInstance(node.expression.expression, bindings) &&
    node.expression.name.text === 'getFixedT' &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text === 'en'
  )
}

function isTranslatorFactory(node, bindings) {
  if (ts.isIdentifier(node)) {
    return bindings.factoryBindings.has(resolvesTo(node, bindings))
  }
  return isNamespaceMember(node, 'createMobileTranslator', bindings)
}

function mobileTranslatorPrefix(node, bindings) {
  if (
    !ts.isCallExpression(node) ||
    !isTranslatorFactory(node.expression, bindings) ||
    node.arguments.length !== 1 ||
    !ts.isStringLiteralLike(node.arguments[0])
  ) {
    return undefined
  }
  return node.arguments[0].text
}

function directTranslatorPrefix(callee, bindings) {
  if (ts.isIdentifier(callee)) {
    const binding = resolvesTo(callee, bindings)
    if (bindings.translatorBindings.has(binding) || bindings.fixedTranslatorBindings.has(binding)) {
      return ''
    }
    return bindings.prefixedTranslatorBindings.get(binding)
  }
  if (isNamespaceMember(callee, 't', bindings)) {
    return ''
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 't' &&
    isMobileI18nInstance(callee.expression, bindings)
  ) {
    return ''
  }
  return undefined
}

export function collectMobileTranslationBindings(sourceFile) {
  const declarations = collectDeclarations(sourceFile)
  const translatorBindings = new Set()
  const factoryBindings = new Set()
  const instanceBindings = new Set()
  const namespaceBindings = new Set()
  const fixedTranslatorBindings = new Set()
  const prefixedTranslatorBindings = new Map()
  const translatorNames = new Set()
  const fixedTranslatorNames = new Set()
  const prefixedTranslatorNames = new Map()
  const bindings = {
    declarations,
    factoryBindings,
    fixedTranslatorBindings,
    fixedTranslatorNames,
    instanceBindings,
    namespaceBindings,
    prefixedTranslatorBindings,
    prefixedTranslatorNames,
    resolveBinding: (identifier) => resolveBinding(identifier, sourceFile, declarations),
    translatorBindings,
    translatorNames
  }

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !MOBILE_I18N_MODULE_RE.test(statement.moduleSpecifier.text)
    ) {
      continue
    }
    const namedBindings = statement.importClause?.namedBindings
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      namespaceBindings.add(namedBindings)
      continue
    }
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text
      if (importedName === 't') {
        translatorBindings.add(element)
        translatorNames.add(element.name.text)
      } else if (importedName === 'createMobileTranslator') {
        factoryBindings.add(element)
      } else if (importedName === 'mobileI18n') {
        instanceBindings.add(element)
      }
    }
  }

  function collectLocalTranslators(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const binding = bindings.resolveBinding(node.name)
      if (isTranslatorFactory(node.initializer, bindings)) {
        factoryBindings.add(binding)
      }
      if (isMobileI18nInstance(node.initializer, bindings)) {
        instanceBindings.add(binding)
      }
      if (isEnglishFixedTranslator(node.initializer, bindings)) {
        fixedTranslatorBindings.add(binding)
        fixedTranslatorNames.add(node.name.text)
      }
      const prefix =
        mobileTranslatorPrefix(node.initializer, bindings) ??
        directTranslatorPrefix(node.initializer, bindings)
      if (prefix !== undefined) {
        prefixedTranslatorBindings.set(binding, prefix)
        prefixedTranslatorNames.set(node.name.text, prefix)
      }
    }
    ts.forEachChild(node, collectLocalTranslators)
  }
  collectLocalTranslators(sourceFile)

  return bindings
}

export function mobileTranslationCallPrefix(call, _sourceFile, bindings) {
  return (
    directTranslatorPrefix(call.expression, bindings) ??
    mobileTranslatorPrefix(call.expression, bindings) ??
    (isEnglishFixedTranslator(call.expression, bindings) ? '' : undefined)
  )
}

export function isMobileTranslationCall(call, sourceFile, bindings) {
  return mobileTranslationCallPrefix(call, sourceFile, bindings) !== undefined
}
