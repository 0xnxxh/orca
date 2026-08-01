// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

import { collectSourceBindings } from './mobile-localization-source-bindings.mjs'

const SOURCE_BINDINGS = new WeakMap()
const SOURCE_IDENTIFIERS = new WeakMap()
const RENDERED_FUNCTION_RESULTS = new WeakMap()

function isDirectDisplayExpressionParent(parent, child) {
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent)
  ) {
    return parent.expression === child
  }
  if (ts.isConditionalExpression(parent)) {
    return parent.whenTrue === child || parent.whenFalse === child
  }
  if (ts.isBinaryExpression(parent)) {
    return [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken
    ].includes(parent.operatorToken.kind)
  }
  return ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)
}

export function isRenderedJsxExpression(node) {
  let child = node
  let current = node.parent
  while (current) {
    if (ts.isJsxExpression(current)) {
      return (
        ts.isJsxElement(current.parent) ||
        ts.isJsxFragment(current.parent) ||
        ts.isJsxSelfClosingElement(current.parent)
      )
    }
    if (
      ts.isConditionalExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTemplateExpression(current) ||
      ts.isNoSubstitutionTemplateLiteral(current)
    ) {
      if (ts.isConditionalExpression(current) && current.condition === child) {
        return false
      }
      child = current
      current = current.parent
      continue
    }
    if (ts.isBinaryExpression(current)) {
      const operator = current.operatorToken.kind
      if (
        ![
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken
        ].includes(operator) ||
        (operator !== ts.SyntaxKind.PlusToken && current.left === child)
      ) {
        return false
      }
      child = current
      current = current.parent
      continue
    }
    return false
  }
  return false
}

function assignedVariableIdentifier(node) {
  let current = node
  while (current.parent && isDirectDisplayExpressionParent(current.parent, current)) {
    current = current.parent
  }
  const parent = current.parent
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === current &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name
  }
  return parent &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === current &&
    ts.isIdentifier(parent.left)
    ? parent.left
    : undefined
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) {
    return node.name.text
  }
  const parent = node.parent
  return (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    parent &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined
}

function directReturnFunction(node) {
  let current = node
  while (current.parent && isDirectDisplayExpressionParent(current.parent, current)) {
    current = current.parent
  }
  const parent = current.parent
  if (parent && ts.isReturnStatement(parent) && parent.expression === current) {
    let owner = parent.parent
    while (owner && !ts.isFunctionLike(owner)) {
      owner = owner.parent
    }
    return owner
  }
  return parent && ts.isArrowFunction(parent) && parent.body === current ? parent : undefined
}

export function directReturnFunctionName(node) {
  const owner = directReturnFunction(node)
  return owner ? functionName(owner) : undefined
}

function bindingsFor(sourceFile) {
  const cached = SOURCE_BINDINGS.get(sourceFile)
  if (cached) {
    return cached
  }
  const bindings = collectSourceBindings(sourceFile)
  SOURCE_BINDINGS.set(sourceFile, bindings)
  return bindings
}

function identifiersFor(sourceFile, name) {
  let byName = SOURCE_IDENTIFIERS.get(sourceFile)
  if (!byName) {
    byName = new Map()
    function visit(node) {
      if (ts.isIdentifier(node)) {
        const matches = byName.get(node.text) ?? []
        matches.push(node)
        byName.set(node.text, matches)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    SOURCE_IDENTIFIERS.set(sourceFile, byName)
  }
  return byName.get(name) ?? []
}

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

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined
}

function propertyValueExpressions(node, propertyName, bindings, seen = new Set()) {
  const expression = unwrapAliasExpression(node)
  if (ts.isIdentifier(expression)) {
    const binding = bindings.resolveBinding(expression)
    if (
      !binding ||
      seen.has(binding) ||
      !ts.isVariableDeclaration(binding) ||
      !binding.initializer
    ) {
      return []
    }
    seen.add(binding)
    return propertyValueExpressions(binding.initializer, propertyName, bindings, seen)
  }
  if (!ts.isObjectLiteralExpression(expression)) {
    return []
  }
  return expression.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === propertyName) {
      return [property.initializer]
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
      return [property.name]
    }
    return ts.isSpreadAssignment(property)
      ? propertyValueExpressions(property.expression, propertyName, bindings, new Set(seen))
      : []
  })
}

function expressionTargetsBinding(node, targets, bindings, seen = new Set()) {
  const expression = unwrapAliasExpression(node)
  if (ts.isIdentifier(expression)) {
    const binding = bindings.resolveBinding(expression)
    return Boolean(binding && targets.has(binding))
  }
  let object
  let propertyName
  if (ts.isPropertyAccessExpression(expression)) {
    object = expression.expression
    propertyName = expression.name.text
  } else if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    object = expression.expression
    propertyName = expression.argumentExpression.text
  }
  if (!object || !propertyName) {
    return false
  }
  return propertyValueExpressions(object, propertyName, bindings, seen).some((value) =>
    expressionTargetsBinding(value, targets, bindings, seen)
  )
}

function renderedFunctionBindings(owner, sourceFile, bindings) {
  const targets = new Set()
  if (owner.name && ts.isIdentifier(owner.name)) {
    const binding = bindings.resolveBinding(owner.name)
    if (binding) {
      targets.add(binding)
    }
  }
  const declaration = owner.parent
  if (
    (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) &&
    ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name)
  ) {
    const binding = bindings.resolveBinding(declaration.name)
    if (binding) {
      targets.add(binding)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    function visit(node) {
      let alias
      let initializer
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        alias = node.name
        initializer = unwrapAliasExpression(node.initializer)
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        alias = node.left
        initializer = unwrapAliasExpression(node.right)
      }
      if (alias && initializer && ts.isIdentifier(initializer)) {
        const sourceBinding = bindings.resolveBinding(initializer)
        const aliasBinding = bindings.resolveBinding(alias)
        if (
          sourceBinding &&
          aliasBinding &&
          targets.has(sourceBinding) &&
          !targets.has(aliasBinding)
        ) {
          targets.add(aliasBinding)
          changed = true
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return targets
}

export function isReturnedByRenderedFunction(node, isRenderedExpression = isRenderedJsxExpression) {
  const owner = directReturnFunction(node)
  if (!owner) {
    return false
  }
  const cached = RENDERED_FUNCTION_RESULTS.get(owner)?.get(isRenderedExpression)
  if (cached !== undefined) {
    return cached
  }
  const sourceFile = node.getSourceFile()
  const bindings = bindingsFor(sourceFile)
  const targetBindings = renderedFunctionBindings(owner, sourceFile, bindings)
  let rendered = false
  function visit(current) {
    if (rendered) {
      return
    }
    if (
      ts.isCallExpression(current) &&
      expressionTargetsBinding(current.expression, targetBindings, bindings) &&
      isRenderedExpression(current)
    ) {
      rendered = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(sourceFile)
  const results = RENDERED_FUNCTION_RESULTS.get(owner) ?? new Map()
  results.set(isRenderedExpression, rendered)
  RENDERED_FUNCTION_RESULTS.set(owner, results)
  return rendered
}

export function isAssignedToRenderedVariable(node, isRenderedExpression = isRenderedJsxExpression) {
  if (ts.isTemplateExpression(node)) {
    return false
  }
  const identifier = assignedVariableIdentifier(node)
  if (!identifier) {
    return false
  }
  const bindings = bindingsFor(node.getSourceFile())
  const targetBinding = bindings.resolveBinding(identifier)
  if (!targetBinding) {
    return false
  }
  let owner = node.parent
  while (owner && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)) {
    owner = owner.parent
  }
  if (!owner) {
    return false
  }
  return identifiersFor(node.getSourceFile(), identifier.text).some(
    (current) =>
      current.pos >= owner.pos &&
      current.end <= owner.end &&
      bindings.resolveBinding(current) === targetBinding &&
      isRenderedExpression(current)
  )
}
