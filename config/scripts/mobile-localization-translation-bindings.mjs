// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

import { collectSourceBindings } from './mobile-localization-source-bindings.mjs'

const MOBILE_I18N_MODULE_RE = /(?:^|\/)mobile-i18n$/

function unwrapAliasExpression(node) {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return unwrapAliasExpression(node.expression)
  }
  return node
}

function resolvesTo(identifier, bindings) {
  return bindings.resolveBinding(identifier)
}

function isMobileI18nNamespace(node, bindings) {
  return ts.isIdentifier(node) && bindings.namespaceBindings.has(resolvesTo(node, bindings))
}

function isNamespaceMember(node, memberName, bindings) {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === memberName &&
    isMobileI18nNamespace(node.expression, bindings)
  )
}

function isMobileI18nInstance(node, bindings) {
  if (ts.isIdentifier(node)) {
    return bindings.instanceBindings.has(resolvesTo(node, bindings))
  }
  return isNamespaceMember(node, 'mobileI18n', bindings)
}

function isFixedTranslatorFactory(node, bindings) {
  if (ts.isIdentifier(node)) {
    return bindings.fixedFactoryBindings.has(resolvesTo(node, bindings))
  }
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'getFixedT' &&
    isMobileI18nInstance(node.expression, bindings)
  )
}

function isEnglishFixedTranslator(node, bindings) {
  return (
    ts.isCallExpression(node) &&
    isFixedTranslatorFactory(node.expression, bindings) &&
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
  const sourceBindings = collectSourceBindings(sourceFile)
  const translatorBindings = new Set()
  const factoryBindings = new Set()
  const fixedFactoryBindings = new Set()
  const instanceBindings = new Set()
  const namespaceBindings = new Set()
  const fixedTranslatorBindings = new Set()
  const prefixedTranslatorBindings = new Map()
  const translatorNames = new Set()
  const fixedTranslatorNames = new Set()
  const instanceNames = new Set()
  const namespaceNames = new Set()
  const prefixedTranslatorNames = new Map()
  const bindings = {
    factoryBindings,
    fixedFactoryBindings,
    fixedTranslatorBindings,
    fixedTranslatorNames,
    instanceBindings,
    instanceNames,
    namespaceBindings,
    namespaceNames,
    prefixedTranslatorBindings,
    prefixedTranslatorNames,
    resolveBinding: sourceBindings.resolveBinding,
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
      namespaceNames.add(namedBindings.name.text)
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
        instanceNames.add(element.name.text)
      }
    }
  }

  function addBinding(identifier, bindingSet, nameSet) {
    const binding = bindings.resolveBinding(identifier)
    if (!binding) {
      return false
    }
    const changed = !bindingSet.has(binding)
    bindingSet.add(binding)
    nameSet?.add(identifier.text)
    return changed
  }

  function destructuredTargets(name) {
    const expression = unwrapAliasExpression(name)
    if (ts.isObjectBindingPattern(expression)) {
      return expression.elements.flatMap((element) => {
        if (!ts.isIdentifier(element.name) || element.dotDotDotToken) {
          return []
        }
        const propertyName = element.propertyName ?? element.name
        return ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)
          ? [{ propertyName: propertyName.text, target: element.name }]
          : []
      })
    }
    if (!ts.isObjectLiteralExpression(expression)) {
      return []
    }
    return expression.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) {
        return [{ propertyName: property.name.text, target: property.name }]
      }
      if (!ts.isPropertyAssignment(property)) {
        return []
      }
      const target = unwrapAliasExpression(property.initializer)
      const propertyName = property.name
      return ts.isIdentifier(target) &&
        (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName))
        ? [{ propertyName: propertyName.text, target }]
        : []
    })
  }

  function collectDestructuredAliases(name, initializer) {
    const namespaceSource = isMobileI18nNamespace(initializer, bindings)
    const instanceSource = isMobileI18nInstance(initializer, bindings)
    if (!namespaceSource && !instanceSource) {
      return false
    }
    let changed = false
    for (const { propertyName, target } of destructuredTargets(name)) {
      if (propertyName === 't') {
        changed = addBinding(target, translatorBindings, translatorNames) || changed
      } else if (namespaceSource && propertyName === 'createMobileTranslator') {
        changed = addBinding(target, factoryBindings) || changed
      } else if (namespaceSource && propertyName === 'mobileI18n') {
        changed = addBinding(target, instanceBindings, instanceNames) || changed
      } else if (instanceSource && propertyName === 'getFixedT') {
        changed = addBinding(target, fixedFactoryBindings) || changed
      }
    }
    return changed
  }

  function addPrefixedBinding(identifier, prefix) {
    const binding = bindings.resolveBinding(identifier)
    if (!binding || prefixedTranslatorBindings.has(binding)) {
      return false
    }
    prefixedTranslatorBindings.set(binding, prefix)
    prefixedTranslatorNames.set(identifier.text, prefix)
    return true
  }

  function collectIdentifierAlias(identifier, initializer) {
    let changed = false
    if (isMobileI18nNamespace(initializer, bindings)) {
      changed = addBinding(identifier, namespaceBindings, namespaceNames) || changed
    } else if (isTranslatorFactory(initializer, bindings)) {
      changed = addBinding(identifier, factoryBindings) || changed
    }
    if (isFixedTranslatorFactory(initializer, bindings)) {
      changed = addBinding(identifier, fixedFactoryBindings) || changed
    }
    if (isMobileI18nInstance(initializer, bindings)) {
      changed = addBinding(identifier, instanceBindings, instanceNames) || changed
    }
    if (isEnglishFixedTranslator(initializer, bindings)) {
      changed = addBinding(identifier, fixedTranslatorBindings, fixedTranslatorNames) || changed
    }
    const prefix =
      mobileTranslatorPrefix(initializer, bindings) ?? directTranslatorPrefix(initializer, bindings)
    return prefix === undefined ? changed : addPrefixedBinding(identifier, prefix) || changed
  }

  function collectLocalTranslators(node) {
    let name
    let initializer
    if (ts.isVariableDeclaration(node) && node.initializer) {
      name = node.name
      initializer = node.initializer
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      name = node.left
      initializer = node.right
    }
    let changed = false
    if (name && initializer) {
      changed = collectDestructuredAliases(name, initializer) || changed
      const target = unwrapAliasExpression(name)
      if (ts.isIdentifier(target)) {
        changed = collectIdentifierAlias(target, initializer) || changed
      }
    }
    ts.forEachChild(node, (child) => {
      changed = collectLocalTranslators(child) || changed
    })
    return changed
  }
  function bindingCount() {
    return [
      factoryBindings,
      fixedFactoryBindings,
      fixedTranslatorBindings,
      instanceBindings,
      namespaceBindings,
      prefixedTranslatorBindings,
      translatorBindings
    ].reduce((total, collection) => total + collection.size, 0)
  }

  let previousCount
  do {
    previousCount = bindingCount()
    collectLocalTranslators(sourceFile)
  } while (bindingCount() > previousCount)

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
