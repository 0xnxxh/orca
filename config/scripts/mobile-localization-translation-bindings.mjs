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

function lexicalScope(node, sourceFile) {
  let current = node.parent
  while (current && current !== sourceFile) {
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isFunctionLike(current)) {
      return current
    }
    current = current.parent
  }
  return sourceFile
}

function functionScope(node, sourceFile) {
  let current = node.parent
  while (current && current !== sourceFile) {
    if (ts.isFunctionLike(current)) {
      return current
    }
    current = current.parent
  }
  return sourceFile
}

function addDeclarations(sourceFile) {
  const declarations = new Map()

  function add(scope, name) {
    const names = declarations.get(scope) ?? new Set()
    names.add(name)
    declarations.set(scope, names)
  }

  function visit(node) {
    if (ts.isParameter(node)) {
      for (const name of bindingNames(node.name)) {
        add(node.parent, name)
      }
    } else if (ts.isVariableDeclaration(node)) {
      const declarationList = node.parent
      const scope =
        ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.BlockScoped) === 0
          ? functionScope(node, sourceFile)
          : lexicalScope(node, sourceFile)
      for (const name of bindingNames(node.name)) {
        add(scope, name)
      }
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      add(lexicalScope(node, sourceFile), node.name.text)
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      for (const name of bindingNames(node.variableDeclaration.name)) {
        add(node, name)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return declarations
}

function isShadowed(identifier, sourceFile, declarations) {
  let current = identifier.parent
  while (current && current !== sourceFile) {
    if (declarations.get(current)?.has(identifier.text)) {
      return true
    }
    current = current.parent
  }
  return false
}

function isEnglishFixedTranslator(node, instanceNames, sourceFile, declarations) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    instanceNames.has(node.expression.expression.text) &&
    !isShadowed(node.expression.expression, sourceFile, declarations) &&
    node.expression.name.text === 'getFixedT' &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text === 'en'
  )
}

function mobileTranslatorPrefix(node, factoryNames, sourceFile, declarations) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    !factoryNames.has(node.expression.text) ||
    isShadowed(node.expression, sourceFile, declarations) ||
    node.arguments.length !== 1 ||
    !ts.isStringLiteralLike(node.arguments[0])
  ) {
    return undefined
  }
  return node.arguments[0].text
}

export function collectMobileTranslationBindings(sourceFile) {
  const translatorNames = new Set()
  const translatorFactoryNames = new Set()
  const instanceNames = new Set()
  const fixedTranslatorNames = new Set()
  const prefixedTranslatorNames = new Map()
  const declarations = addDeclarations(sourceFile)

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !MOBILE_I18N_MODULE_RE.test(statement.moduleSpecifier.text)
    ) {
      continue
    }
    for (const element of statement.importClause?.namedBindings?.elements ?? []) {
      const importedName = element.propertyName?.text ?? element.name.text
      if (importedName === 't') {
        translatorNames.add(element.name.text)
      } else if (importedName === 'createMobileTranslator') {
        translatorFactoryNames.add(element.name.text)
      } else if (importedName === 'mobileI18n') {
        instanceNames.add(element.name.text)
      }
    }
  }

  function collectFixed(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isEnglishFixedTranslator(node.initializer, instanceNames, sourceFile, declarations)
    ) {
      fixedTranslatorNames.add(node.name.text)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const prefix = mobileTranslatorPrefix(
        node.initializer,
        translatorFactoryNames,
        sourceFile,
        declarations
      )
      if (prefix !== undefined) {
        prefixedTranslatorNames.set(node.name.text, prefix)
      }
    }
    ts.forEachChild(node, collectFixed)
  }
  collectFixed(sourceFile)

  return {
    declarations,
    fixedTranslatorNames,
    instanceNames,
    prefixedTranslatorNames,
    translatorNames
  }
}

export function mobileTranslationCallPrefix(call, sourceFile, bindings) {
  const callee = call.expression
  if (ts.isIdentifier(callee)) {
    if (isShadowed(callee, sourceFile, bindings.declarations)) {
      return undefined
    }
    if (
      bindings.translatorNames.has(callee.text) ||
      bindings.fixedTranslatorNames.has(callee.text)
    ) {
      return ''
    }
    return bindings.prefixedTranslatorNames.get(callee.text)
  }
  return isEnglishFixedTranslator(callee, bindings.instanceNames, sourceFile, bindings.declarations)
    ? ''
    : undefined
}

export function isMobileTranslationCall(call, sourceFile, bindings) {
  return mobileTranslationCallPrefix(call, sourceFile, bindings) !== undefined
}
