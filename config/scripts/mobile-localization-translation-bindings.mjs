// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

import { collectSourceBindings } from './mobile-localization-source-bindings.mjs'

const MOBILE_I18N_MODULE_RE = /(?:^|\/)mobile-i18n$/

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
      return
    }
    bindingSet.add(binding)
    nameSet?.add(identifier.text)
  }

  function collectDestructuredAliases(node) {
    if (!ts.isObjectBindingPattern(node.name) || !node.initializer) {
      return
    }
    const namespaceSource = isMobileI18nNamespace(node.initializer, bindings)
    const instanceSource = isMobileI18nInstance(node.initializer, bindings)
    if (!namespaceSource && !instanceSource) {
      return
    }
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name) || element.dotDotDotToken) {
        continue
      }
      const propertyName = element.propertyName ?? element.name
      if (!ts.isIdentifier(propertyName) && !ts.isStringLiteralLike(propertyName)) {
        continue
      }
      if (propertyName.text === 't') {
        addBinding(element.name, translatorBindings, translatorNames)
      } else if (namespaceSource && propertyName.text === 'createMobileTranslator') {
        addBinding(element.name, factoryBindings)
      } else if (namespaceSource && propertyName.text === 'mobileI18n') {
        addBinding(element.name, instanceBindings, instanceNames)
      } else if (instanceSource && propertyName.text === 'getFixedT') {
        addBinding(element.name, fixedFactoryBindings)
      }
    }
  }

  function collectLocalTranslators(node) {
    if (ts.isVariableDeclaration(node)) {
      collectDestructuredAliases(node)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const binding = bindings.resolveBinding(node.name)
      if (!binding) {
        ts.forEachChild(node, collectLocalTranslators)
        return
      }
      if (isMobileI18nNamespace(node.initializer, bindings)) {
        namespaceBindings.add(binding)
        namespaceNames.add(node.name.text)
      } else if (isTranslatorFactory(node.initializer, bindings)) {
        factoryBindings.add(binding)
      }
      if (isFixedTranslatorFactory(node.initializer, bindings)) {
        fixedFactoryBindings.add(binding)
      }
      if (isMobileI18nInstance(node.initializer, bindings)) {
        instanceBindings.add(binding)
        instanceNames.add(node.name.text)
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
