// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

const ASSIGNMENT_KINDS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
])

function unwrapExpression(node) {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return unwrapExpression(node.expression)
  }
  return node
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text
  }
  return undefined
}

function statementContainer(node) {
  let current = node
  while (current.parent) {
    if (
      ts.isSourceFile(current.parent) ||
      ts.isBlock(current.parent) ||
      ts.isModuleBlock(current.parent) ||
      ts.isCaseBlock(current.parent) ||
      ts.isClassStaticBlockDeclaration(current.parent)
    ) {
      return { container: current.parent, statement: current }
    }
    current = current.parent
  }
  return undefined
}

function isConstBinding(binding) {
  const declaration = ts.isBindingElement(binding) ? binding.parent.parent : binding
  const declarationList = ts.isVariableDeclaration(declaration) ? declaration.parent : undefined
  return Boolean(
    declarationList &&
    ts.isVariableDeclarationList(declarationList) &&
    (declarationList.flags & ts.NodeFlags.Const) !== 0
  )
}

function isDefiniteBefore(write, use) {
  if (write.conditional) {
    return false
  }
  const writeStatement = statementContainer(write.node)
  const useStatement = statementContainer(use)
  return Boolean(
    writeStatement &&
    useStatement &&
    writeStatement.container === useStatement.container &&
    writeStatement.statement.end <= useStatement.statement.pos
  )
}

function destructuredTargets(name) {
  const target = unwrapExpression(name)
  if (ts.isObjectBindingPattern(target)) {
    return target.elements.flatMap((element) => {
      if (!ts.isIdentifier(element.name) || element.dotDotDotToken) {
        return []
      }
      const propertyName = propertyNameText(element.propertyName ?? element.name)
      return propertyName ? [{ identifier: element.name, propertyName }] : []
    })
  }
  if (!ts.isObjectLiteralExpression(target)) {
    return []
  }
  return target.properties.flatMap((property) => {
    if (ts.isShorthandPropertyAssignment(property)) {
      return [{ identifier: property.name, propertyName: property.name.text }]
    }
    if (!ts.isPropertyAssignment(property)) {
      return []
    }
    const identifier = unwrapExpression(property.initializer)
    const propertyName = propertyNameText(property.name)
    return ts.isIdentifier(identifier) && propertyName ? [{ identifier, propertyName }] : []
  })
}

export function createMobileLocalizationValueFlow(sourceFile, bindings) {
  const writes = new Map()
  const propertyWrites = new Map()

  function addWrite(identifier, expression, node, propertyName, conditional = false) {
    const binding = bindings.resolveBinding(identifier)
    if (!binding) {
      return
    }
    const entries = writes.get(binding) ?? []
    entries.push({
      conditional,
      expression,
      node,
      position: node.getStart(sourceFile),
      propertyName
    })
    writes.set(binding, entries)
  }

  function addTargetWrites(name, expression, node, conditional = false) {
    const target = unwrapExpression(name)
    if (ts.isIdentifier(target)) {
      addWrite(target, expression, node, undefined, conditional)
      return
    }
    for (const entry of destructuredTargets(target)) {
      addWrite(entry.identifier, expression, node, entry.propertyName, conditional)
    }
  }

  function memberWriteTarget(node) {
    const target = unwrapExpression(node)
    if (ts.isPropertyAccessExpression(target)) {
      const object = unwrapExpression(target.expression)
      return ts.isIdentifier(object)
        ? { identifier: object, propertyName: target.name.text }
        : undefined
    }
    if (
      ts.isElementAccessExpression(target) &&
      target.argumentExpression &&
      ts.isStringLiteralLike(target.argumentExpression)
    ) {
      const object = unwrapExpression(target.expression)
      return ts.isIdentifier(object)
        ? { identifier: object, propertyName: target.argumentExpression.text }
        : undefined
    }
    return undefined
  }

  function addPropertyWrite(target, expression, node, conditional) {
    const binding = bindings.resolveBinding(target.identifier)
    if (!binding) {
      return
    }
    const byName = propertyWrites.get(binding) ?? new Map()
    const entries = byName.get(target.propertyName) ?? []
    entries.push({ conditional, expression, node, position: node.getStart(sourceFile) })
    byName.set(target.propertyName, entries)
    propertyWrites.set(binding, byName)
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      addTargetWrites(node.name, node.initializer, node)
    } else if (ts.isBinaryExpression(node) && ASSIGNMENT_KINDS.has(node.operatorToken.kind)) {
      const conditional = node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      const memberTarget = memberWriteTarget(node.left)
      if (memberTarget) {
        addPropertyWrite(memberTarget, node.right, node, conditional)
      } else {
        addTargetWrites(node.left, node.right, node, conditional)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  for (const entries of writes.values()) {
    entries.sort((left, right) => left.position - right.position)
  }
  for (const byName of propertyWrites.values()) {
    for (const entries of byName.values()) {
      entries.sort((left, right) => left.position - right.position)
    }
  }

  function selectedWrites(identifier, use, all) {
    const binding = bindings.resolveBinding(identifier)
    const entries = binding ? (writes.get(binding) ?? []) : []
    if (all || (binding && isConstBinding(binding))) {
      return entries
    }
    const usePosition = use.getStart(sourceFile)
    const available = entries.filter((entry) => entry.position < usePosition)
    let selected = []
    for (const entry of available) {
      if (isDefiniteBefore(entry, use)) {
        selected = [entry]
      } else {
        selected.push(entry)
      }
    }
    return selected
  }

  function propertyValues(node, propertyName, use = node, seen = new Set(), all = false) {
    const expression = unwrapExpression(node)
    if (ts.isIdentifier(expression)) {
      const binding = bindings.resolveBinding(expression)
      if (!binding || seen.has(binding)) {
        return undefined
      }
      const nextSeen = new Set(seen).add(binding)
      const values = all
        ? allValueExpressions(expression, use, nextSeen)
        : valueExpressions(expression, use, nextSeen)
      const resolved = []
      let known = values !== undefined
      for (const value of values ?? []) {
        const matches = propertyValues(value, propertyName, use, nextSeen, all)
        if (matches === undefined) {
          known = false
        } else {
          resolved.push(...matches)
        }
      }
      const entries = propertyWrites.get(binding)?.get(propertyName) ?? []
      const usePosition = use.getStart(sourceFile)
      for (const entry of all ? entries : entries.filter((value) => value.position < usePosition)) {
        if (all) {
          resolved.push(entry.expression)
        } else if (isDefiniteBefore(entry, use)) {
          resolved.splice(0, resolved.length, entry.expression)
          known = true
        } else {
          resolved.push(entry.expression)
        }
      }
      return known || (all && resolved.length > 0) ? resolved : undefined
    }
    if (!ts.isObjectLiteralExpression(expression)) {
      return undefined
    }
    for (const property of expression.properties.toReversed()) {
      if (ts.isSpreadAssignment(property)) {
        const spreadValues = propertyValues(
          property.expression,
          propertyName,
          use,
          new Set(seen),
          all
        )
        if (spreadValues === undefined || spreadValues.length > 0) {
          return spreadValues
        }
        continue
      }
      const name = propertyNameText(property.name)
      if (name === undefined) {
        return undefined
      }
      if (name !== propertyName) {
        continue
      }
      if (ts.isPropertyAssignment(property)) {
        return [property.initializer]
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return [property.name]
      }
      if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property)) {
        return [property]
      }
      return undefined
    }
    return []
  }

  function materializeWrites(entries, use, seen) {
    const values = []
    for (const entry of entries) {
      if (!entry.propertyName) {
        values.push(entry.expression)
        continue
      }
      const matches = propertyValues(entry.expression, entry.propertyName, use, new Set(seen))
      if (matches === undefined) {
        return undefined
      }
      values.push(...matches)
    }
    return values
  }

  function valueExpressions(identifier, use = identifier, seen = new Set()) {
    return materializeWrites(selectedWrites(identifier, use, false), use, seen)
  }

  function allValueExpressions(identifier, use = identifier, seen = new Set()) {
    return materializeWrites(selectedWrites(identifier, use, true), use, seen)
  }

  function valueSources(identifier, use = identifier, all = false) {
    return selectedWrites(identifier, use, all)
  }

  function bindingWrites() {
    return writes.entries()
  }

  function writeReachesUse(write, use) {
    return isDefiniteBefore(write, use)
  }

  return {
    allValueExpressions,
    bindingWrites,
    isImmutableBinding: isConstBinding,
    propertyValues,
    unwrapExpression,
    valueExpressions,
    valueSources,
    writeReachesUse
  }
}
